using System.Security.Cryptography;
using System.Text;

namespace Snote.ScannerConnector.Core;

// Capabilities and codes are memory-only. This helper never accepts a cloud JWT.
public sealed record PairingResult(string Token, DateTimeOffset ExpiresAt);
public sealed record LocalCapability(string Key, string Origin, DateTimeOffset ExpiresAt);
public sealed class PairingState
{
    private readonly object gate = new();
    private readonly TimeProvider clock;
    private readonly Dictionary<string, LocalCapability> capabilities = new(StringComparer.Ordinal);
    private string code = "";
    private DateTimeOffset codeExpires, attemptWindow;
    private int attempts;
    private long generation;
    public PairingState(TimeProvider? timeProvider = null)
    {
        clock = timeProvider ?? TimeProvider.System;
        Rotate();
    }
    public string CurrentCode { get { lock (gate) { EnsureCode(); return code; } } }
    public long Generation { get { lock (gate) return generation; } }
    public void Rotate()
    {
        lock (gate) { NewCode(); }
    }
    private void NewCode()
    {
        var previous = code;
        do { code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6"); } while (code == previous);
        codeExpires = clock.GetUtcNow().AddMinutes(10);
    }
    private void EnsureCode() { if (clock.GetUtcNow() >= codeExpires) NewCode(); }
    private static string Digest(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    public PairingResult Pair(string suppliedCode, string origin)
    {
        lock (gate)
        {
            var now = clock.GetUtcNow();
            if (now >= attemptWindow.AddMinutes(1)) { attemptWindow = now; attempts = 0; }
            if (++attempts > 5) throw new ConnectorException("BAD_CODE", 429);
            EnsureCode();
            if (suppliedCode.Length != 6 || suppliedCode.Any(c => c is < '0' or > '9') ||
                !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(code), Encoding.ASCII.GetBytes(suppliedCode)))
                throw new ConnectorException("BAD_CODE", 401);
            var result = Issue(origin, now);
            NewCode();
            return result;
        }
    }
    public PairingResult IssueApproved(string origin, long expectedGeneration, Action? remember = null)
    {
        lock (gate)
        {
            if (generation != expectedGeneration) throw new ConnectorException("CANCELLED", 409);
            // Reset acquires this gate before clearing the durable store. A
            // delayed approval cannot re-add trust or mint a token after reset.
            remember?.Invoke();
            return Issue(origin, clock.GetUtcNow());
        }
    }
    private PairingResult Issue(string origin, DateTimeOffset now)
    {
        foreach (var key in capabilities.Where(p => p.Value.ExpiresAt <= now).Select(p => p.Key).ToArray()) capabilities.Remove(key);
        if (capabilities.Count >= 8) capabilities.Remove(capabilities.MinBy(p => p.Value.ExpiresAt).Key);
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var expires = now.AddHours(12);
        capabilities.Add(Digest(token), new(Digest(token), origin, expires));
        return new(token, expires);
    }
    public void RevokeAll(Action? clearTrust = null)
    {
        lock (gate)
        {
            capabilities.Clear();
            generation++;
            clearTrust?.Invoke();
            NewCode();
        }
    }
    public LocalCapability Authenticate(string token, string origin)
    {
        lock (gate)
        {
            if (token.Length != 64 || token.Any(c => !char.IsAsciiHexDigit(c)) ||
                !capabilities.TryGetValue(Digest(token), out var capability) ||
                capability.Origin != origin || capability.ExpiresAt <= clock.GetUtcNow())
                throw new ConnectorException("PAIRING_REQUIRED", 401);
            return capability;
        }
    }
    public bool IsCurrent(LocalCapability capability)
    {
        lock (gate) return capabilities.TryGetValue(capability.Key, out var current) &&
            current == capability && current.ExpiresAt > clock.GetUtcNow();
    }
    public void Revoke(LocalCapability capability) { lock (gate) capabilities.Remove(capability.Key); }
}
