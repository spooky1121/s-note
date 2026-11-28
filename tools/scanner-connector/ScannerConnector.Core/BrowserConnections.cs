using System.Security.Cryptography;

namespace Snote.ScannerConnector.Core;

// The persistent credential is a public key. Cloud credentials, scan results
// and browser private keys never enter this store.
public sealed record ScannerTrustEntry(string Origin, string ClientId, string Scope, string PublicKey);
public interface IScannerTrustStore
{
    bool IsTrusted(ScannerTrustEntry entry);
    void Remember(ScannerTrustEntry entry);
    void Clear();
}
public sealed record ScannerConnectionRequest(string Origin, string ClientId, string Scope);
public sealed record ScannerConnectionDecision(bool Approved, bool Remember);
public interface IScannerConnectionApproval
{
    Task<ScannerConnectionDecision> ApproveAsync(ScannerConnectionRequest request, CancellationToken cancellationToken);
}
public sealed record ScannerConnectionChallenge(Guid Id, string Challenge, DateTimeOffset ExpiresAt);
public sealed record ScannerConnectionResult(string Token, DateTimeOffset ExpiresAt, bool Remembered);

/// <summary>
/// A fresh one-use proof binds an origin, browser key, account scope and web
/// session before a new in-memory scan capability can be issued. Native consent
/// is required for every key/scope that the user has not chosen to remember.
/// </summary>
public sealed class BrowserConnections : IDisposable
{
    private sealed record Pending(ScannerTrustEntry Entry, string Session, byte[] Nonce,
        DateTimeOffset ExpiresAt, long Generation);
    private sealed record Window(DateTimeOffset StartedAt, int Attempts);
    private readonly object gate = new();
    private readonly PairingState pairing;
    private readonly TimeProvider clock;
    private readonly IScannerTrustStore? store;
    private readonly IScannerConnectionApproval? approval;
    private readonly Dictionary<Guid, Pending> pending = [];
    private readonly Dictionary<string, Window> windows = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim approvalGate = new(1, 1);
    private readonly CancellationTokenSource stopped = new();
    private bool disposed;

    public BrowserConnections(PairingState pairing, IScannerTrustStore? store = null,
        IScannerConnectionApproval? approval = null, TimeProvider? timeProvider = null)
    {
        this.pairing = pairing;
        this.store = store;
        this.approval = approval;
        clock = timeProvider ?? TimeProvider.System;
    }

    public ScannerConnectionChallenge Start(string origin, string clientId, string scope,
        string session, string publicKey)
    {
        RequireOrigin(origin);
        if (!Hex(clientId) || !Hex(scope) || !Hex(session)) throw Invalid();
        var key = Decode(publicKey, 91);
        try
        {
            using var verifier = ECDsa.Create();
            verifier.ImportSubjectPublicKeyInfo(key, out var read);
            var parameters = verifier.ExportParameters(false);
            if (read != key.Length || verifier.KeySize != 256 ||
                parameters.Curve.Oid.Value != ECCurve.NamedCurves.nistP256.Oid.Value ||
                !verifier.ExportSubjectPublicKeyInfo().AsSpan().SequenceEqual(key) ||
                !CryptographicOperations.FixedTimeEquals(SHA256.HashData(key), Convert.FromHexString(clientId))) throw Invalid();
        }
        catch (CryptographicException) { throw Invalid(); }
        lock (gate)
        {
            if (disposed) throw Cancelled();
            var now = clock.GetUtcNow();
            foreach (var item in pending.Where(p => p.Value.ExpiresAt <= now || p.Value.Generation != pairing.Generation).ToArray())
            {
                CryptographicOperations.ZeroMemory(item.Value.Nonce);
                pending.Remove(item.Key);
            }
            var window = windows.GetValueOrDefault(origin);
            if (window is null || now >= window.StartedAt.AddMinutes(1)) window = new(now, 0);
            windows[origin] = window with { Attempts = window.Attempts + 1 };
            if (window.Attempts >= 12) throw new ConnectorException("TOO_MANY_ATTEMPTS", 429);
            if (pending.Count >= 8) throw new ConnectorException("BUSY", 409);
            var id = Guid.NewGuid();
            var nonce = RandomNumberGenerator.GetBytes(32);
            var expires = now.AddMinutes(2);
            pending.Add(id, new(new(origin, clientId, scope, publicKey), session, nonce, expires, pairing.Generation));
            return new(id, Convert.ToBase64String(nonce), expires);
        }
    }

    public async Task<ScannerConnectionResult> FinishAsync(string origin, Guid id,
        string signature, CancellationToken cancellationToken)
    {
        RequireOrigin(origin);
        Pending request;
        lock (gate)
        {
            if (disposed) throw Cancelled();
            if (!pending.TryGetValue(id, out var value)) throw new ConnectorException("EXPIRED", 410);
            // Another allowed origin cannot consume the legitimate request.
            if (value.Entry.Origin != origin) throw new ConnectorException("FORBIDDEN", 403);
            pending.Remove(id);
            request = value;
        }
        try
        {
            if (request.ExpiresAt <= clock.GetUtcNow()) throw new ConnectorException("EXPIRED", 410);
            if (request.Generation != pairing.Generation) throw Cancelled();
            var proof = Decode(signature, 64);
            using (var verifier = ECDsa.Create())
            {
                verifier.ImportSubjectPublicKeyInfo(Convert.FromBase64String(request.Entry.PublicKey), out _);
                if (!verifier.VerifyData(request.Nonce, proof, HashAlgorithmName.SHA256,
                    DSASignatureFormat.IeeeP1363FixedFieldConcatenation)) throw new ConnectorException("FORBIDDEN", 403);
            }
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, stopped.Token);
            timeout.CancelAfter(TimeSpan.FromSeconds(90));
            timeout.Token.ThrowIfCancellationRequested();
            var trusted = store?.IsTrusted(request.Entry) == true;
            bool remember = false;
            if (!trusted)
            {
                if (approval is null) throw new ConnectorException("CONNECTION_DENIED", 403);
                if (!await approvalGate.WaitAsync(0, timeout.Token)) throw new ConnectorException("BUSY", 409);
                try
                {
                    var decision = await approval.ApproveAsync(new(request.Entry.Origin,
                        request.Entry.ClientId, request.Entry.Scope), timeout.Token).WaitAsync(timeout.Token);
                    timeout.Token.ThrowIfCancellationRequested();
                    if (!decision.Approved) throw new ConnectorException("CONNECTION_DENIED", 403);
                    remember = decision.Remember;
                    if (remember && store is null) throw new ConnectorException("CONNECTION_DENIED", 403);
                }
                finally { approvalGate.Release(); }
            }
            timeout.Token.ThrowIfCancellationRequested();
            if (request.ExpiresAt <= clock.GetUtcNow()) throw new ConnectorException("EXPIRED", 410);
            var capability = pairing.IssueApproved(origin, request.Generation,
                remember ? () => store!.Remember(request.Entry) : null);
            return new(capability.Token, capability.ExpiresAt, trusted || remember);
        }
        catch (CryptographicException) { throw new ConnectorException("FORBIDDEN", 403); }
        catch (OperationCanceledException) { throw Cancelled(); }
        finally { CryptographicOperations.ZeroMemory(request.Nonce); }
    }

    private static void RequireOrigin(string origin)
    {
        if (!ConnectorHost.IsAllowedOrigin(origin)) throw new ConnectorException("FORBIDDEN", 403);
    }
    private static bool Hex(string value) => value is { Length: 64 } && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static byte[] Decode(string value, int size)
    {
        if (value is null || value.Length != ((size + 2) / 3) * 4) throw Invalid();
        try
        {
            var bytes = Convert.FromBase64String(value);
            if (bytes.Length != size || Convert.ToBase64String(bytes) != value) throw Invalid();
            return bytes;
        }
        catch (FormatException) { throw Invalid(); }
    }
    private static ConnectorException Invalid() => new("INVALID_REQUEST", 400);
    private static ConnectorException Cancelled() => new("CANCELLED", 409);
    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
            stopped.Cancel();
            foreach (var request in pending.Values) CryptographicOperations.ZeroMemory(request.Nonce);
            pending.Clear();
        }
        // In-flight finish handlers still observe this token and release their
        // semaphore. Do not dispose those synchronization objects underneath them.
    }
}
