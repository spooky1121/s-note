using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Snote.ScannerConnector.Core;

// Disposable signing keys, generated scan bytes and fake approval/store only.
// The native WIA adapter and real user credentials are never referenced.
static class BrowserConnectionTests
{
    const string Site = "https://s-note.kr", Other = "https://s-note.pages.dev";
    static readonly string Scope = Hex("synthetic-company:user"), Session = Hex("synthetic-session");
    static readonly List<string> Passed = [];
    public static async Task ServeAsync()
    {
        // Only this test executable references this fake adapter/approval. The
        // production Windows project never references this test assembly.
        await using var host = await Host.Create(17426);
        host.Clock.Advance(DateTimeOffset.UtcNow - host.Clock.GetUtcNow());
        Console.WriteLine("SNOTE_SYNTHETIC_SCANNER_V2_READY " + JsonSerializer.Serialize(new
        {
            address = host.Http.BaseAddress!.ToString(), protocol = ConnectorHost.Protocol,
            version = ConnectorHost.Version, actualWiaUsed = false,
            testAssemblyOnlyAutomaticApproval = true
        }));
        await host.WaitForShutdown();
    }
    public static async Task<IReadOnlyList<string>> RunAsync()
    {
        await Case("code-free proof requires native approval; remembered key reconnects with a fresh capability", async () =>
        {
            using var key = new Identity(); await using var h = await Host.Create();
            Equal(401, (await h.Get("/v1/devices")).Status);
            var token = await h.Connect(key); Equal(1, h.Approval.Calls); Equal(1, h.Store.Count);
            Equal(200, (await h.Get("/v1/devices", token)).Status);
            var next = await h.Connect(key, session: Hex("another-session"));
            Equal(1, h.Approval.Calls); Check(token != next, "Sessions shared a capability");
            var id = Guid.NewGuid();
            Equal(202, (await h.Post("/v1/scans", new { id, deviceId = "generic-device", source = "flatbed", dpi = 300, color = "color" }, token)).Status);
            Equal(404, (await h.Get("/v1/scans/" + id, next)).Status);
        });
        await Case("production default has no legacy pairing-code bypass", async () =>
        {
            await using var h = await Host.Create();
            Equal(404, (await h.Post("/v1/pair", new { code = h.Pairing.CurrentCode })).Status);
            Equal(401, (await h.Get("/v1/devices")).Status); Equal(0, h.Approval.Calls);
        });
        await Case("trust is separated by exact origin and opaque account scope", async () =>
        {
            using var key = new Identity(); await using var h = await Host.Create();
            var token = await h.Connect(key);
            await h.Connect(key, origin: Other); Equal(2, h.Approval.Calls);
            Equal(401, (await h.Get("/v1/devices", token, Other)).Status);
            await h.Connect(key, scope: Hex("another-company:user")); Equal(3, h.Approval.Calls);
            await h.Connect(key); Equal(3, h.Approval.Calls);
        });
        await Case("one-use nonce rejects replay, wrong-key proof and foreign-origin consumption", async () =>
        {
            using var key = new Identity(); using var wrong = new Identity(); await using var h = await Host.Create();
            var challenge = await h.Start(key);
            Equal(403, (await h.Finish(challenge, key, Other)).Status);
            Equal(200, (await h.Finish(challenge, key)).Status);
            Equal(410, (await h.Finish(challenge, key)).Status);
            var bad = await h.Start(key);
            Equal(403, (await h.Finish(bad, wrong)).Status);
            Equal(410, (await h.Finish(bad, key)).Status);
            Equal(1, h.Approval.Calls);
        });
        await Case("malformed keys, scopes, signatures and JSON fail before native consent", async () =>
        {
            using var key = new Identity(); await using var h = await Host.Create();
            foreach (var origin in new[] { "https://evil.invalid", "null", "http://s-note.kr", "https://s-note.kr.evil.invalid" })
                Equal(403, (await h.Post("/v2/connect/start", key.Body(), origin: origin)).Status);
            Equal(400, (await h.Post("/v2/connect/start", new { clientId = new string('0', 64), scope = Scope, session = Session, publicKey = key.PublicKey })).Status);
            Equal(400, (await h.Post("/v2/connect/start", new { clientId = key.Id, scope = "bad", session = Session, publicKey = key.PublicKey })).Status);
            Equal(400, (await h.Post("/v2/connect/start", new { clientId = key.Id, scope = Scope, session = Session, publicKey = key.PublicKey, extra = true })).Status);
            Equal(404, (await h.Post("/v2/connect/start?extra=1", key.Body())).Status);
            var challenge = await h.Start(key);
            Equal(400, (await h.Post("/v2/connect/finish", new { id = challenge.Id, signature = new string('A', 88) })).Status);
            Equal(410, (await h.Finish(challenge, key)).Status);
            Equal(0, h.Approval.Calls); Equal(0, h.Store.Count);
        });
        await Case("declined consent does not remember a key or grant a device capability", async () =>
        {
            using var key = new Identity(); await using var h = await Host.Create();
            h.Approval.Handler = (_, _) => Task.FromResult(new ScannerConnectionDecision(false, true));
            var response = await h.Finish(await h.Start(key), key);
            Equal(403, response.Status); Equal("CONNECTION_DENIED", response.Text("code")); Equal(0, h.Store.Count);
            h.Approval.Handler = (_, _) => Task.FromResult(new ScannerConnectionDecision(true, false));
            await h.Connect(key); Equal(0, h.Store.Count);
            await h.Connect(key); Equal(3, h.Approval.Calls);
        });
        await Case("unconfigured headless helper cannot silently approve a browser", async () =>
        {
            using var key = new Identity(); var clock = new Clock(); var pairing = new PairingState(clock);
            using var connections = new BrowserConnections(pairing, timeProvider: clock);
            var challenge = connections.Start(Site, key.Id, Scope, Session, key.PublicKey);
            await Error("CONNECTION_DENIED", () => connections.FinishAsync(Site, challenge.Id, key.Sign(challenge.Challenge), default));
        });
        await Case("challenge expires before proof and also while native consent is open", async () =>
        {
            using var key = new Identity(); await using var h = await Host.Create();
            var old = await h.Start(key); h.Clock.Advance(TimeSpan.FromMinutes(3));
            Equal(410, (await h.Finish(old, key)).Status); Equal(0, h.Approval.Calls);
            h.Approval.Handler = (_, _) => { h.Clock.Advance(TimeSpan.FromMinutes(3)); return Task.FromResult(new ScannerConnectionDecision(true, true)); };
            Equal(410, (await h.Finish(await h.Start(key), key)).Status); Equal(0, h.Store.Count);
        });
        await Case("cancelled browser approval cannot later grant remembered trust", async () =>
        {
            using var key = new Identity(); var clock = new Clock(); var pairing = new PairingState(clock); var store = new Store();
            var answer = new TaskCompletionSource<ScannerConnectionDecision>(TaskCreationOptions.RunContinuationsAsynchronously);
            var approval = new Approval { Handler = (_, _) => answer.Task };
            using var connections = new BrowserConnections(pairing, store, approval, clock);
            var challenge = connections.Start(Site, key.Id, Scope, Session, key.PublicKey);
            using var abort = new CancellationTokenSource();
            var pending = connections.FinishAsync(Site, challenge.Id, key.Sign(challenge.Challenge), abort.Token);
            Equal(1, approval.Calls); abort.Cancel(); await Error("CANCELLED", () => pending);
            answer.TrySetResult(new(true, true)); await Task.Yield(); Equal(0, store.Count);
        });
        await Case("reset invalidates old proofs, live capabilities and delayed approvals", async () =>
        {
            using var key = new Identity(); var clock = new Clock(); var pairing = new PairingState(clock); var store = new Store();
            var answer = new TaskCompletionSource<ScannerConnectionDecision>(TaskCreationOptions.RunContinuationsAsynchronously);
            var approval = new Approval { Handler = (_, _) => answer.Task };
            using var connections = new BrowserConnections(pairing, store, approval, clock);
            var token = pairing.Pair(pairing.CurrentCode, Site).Token;
            var challenge = connections.Start(Site, key.Id, Scope, Session, key.PublicKey);
            var pending = connections.FinishAsync(Site, challenge.Id, key.Sign(challenge.Challenge), default);
            pairing.RevokeAll(store.Clear); answer.TrySetResult(new(true, true));
            await Error("CANCELLED", () => pending); Equal(0, store.Count);
            Throws("PAIRING_REQUIRED", () => pairing.Authenticate(token, Site));
            var previous = connections.Start(Site, key.Id, Scope, Session, key.PublicKey); pairing.RevokeAll(store.Clear);
            await Error("CANCELLED", () => connections.FinishAsync(Site, previous.Id, key.Sign(previous.Challenge), default));
        });
        await Case("durable trust reset is atomic against a new challenge and reconnect", async () =>
        {
            using var key = new Identity(); var clock = new Clock(); var pairing = new PairingState(clock); var store = new Store();
            store.Remember(new(Site, key.Id, Scope, key.PublicKey)); var approval = new Approval();
            using var connections = new BrowserConnections(pairing, store, approval, clock);
            using var entered = new ManualResetEventSlim(); using var release = new ManualResetEventSlim();
            var reset = Task.Run(() => pairing.RevokeAll(() => { entered.Set(); Check(release.Wait(3000), "Reset test release missing"); store.Clear(); }));
            Check(entered.Wait(3000), "Reset test did not enter");
            var start = Task.Run(() => connections.Start(Site, key.Id, Scope, Session, key.PublicKey));
            await Task.Delay(30); Check(!start.IsCompleted, "Challenge crossed a partial trust reset");
            release.Set(); await reset; var next = await start;
            await connections.FinishAsync(Site, next.Id, key.Sign(next.Challenge), default);
            Equal(1, approval.Calls);
        });
        await Case("trusted browser survives helper restart but old nonce and token do not", async () =>
        {
            using var key = new Identity(); var clock = new Clock(); var store = new Store(); var firstPairing = new PairingState(clock); var firstApproval = new Approval();
            ScannerConnectionChallenge old; ScannerConnectionResult result;
            using (var first = new BrowserConnections(firstPairing, store, firstApproval, clock))
            {
                var initial = first.Start(Site, key.Id, Scope, Session, key.PublicKey);
                result = await first.FinishAsync(Site, initial.Id, key.Sign(initial.Challenge), default);
                old = first.Start(Site, key.Id, Scope, Session, key.PublicKey);
            }
            var secondPairing = new PairingState(clock); var secondApproval = new Approval();
            using var second = new BrowserConnections(secondPairing, store, secondApproval, clock);
            Throws("PAIRING_REQUIRED", () => secondPairing.Authenticate(result.Token, Site));
            await Error("EXPIRED", () => second.FinishAsync(Site, old.Id, key.Sign(old.Challenge), default));
            var next = second.Start(Site, key.Id, Scope, Hex("new-session"), key.PublicKey);
            await second.FinishAsync(Site, next.Id, key.Sign(next.Challenge), default); Equal(0, secondApproval.Calls);
        });
        await Case("one native consent dialog at a time; remembered reconnect does not prompt again", async () =>
        {
            using var key = new Identity(); var clock = new Clock(); var pairing = new PairingState(clock); var store = new Store();
            var answer = new TaskCompletionSource<ScannerConnectionDecision>(TaskCreationOptions.RunContinuationsAsynchronously);
            var approval = new Approval { Handler = (_, _) => answer.Task };
            using var connections = new BrowserConnections(pairing, store, approval, clock);
            var first = connections.Start(Site, key.Id, Scope, Session, key.PublicKey);
            var pending = connections.FinishAsync(Site, first.Id, key.Sign(first.Challenge), default);
            var other = connections.Start(Site, key.Id, Scope, Session, key.PublicKey);
            await Error("BUSY", () => connections.FinishAsync(Site, other.Id, key.Sign(other.Challenge), default));
            Equal(1, approval.Calls); answer.TrySetResult(new(true, true)); await pending;
            var next = connections.Start(Site, key.Id, Scope, Session, key.PublicKey);
            await connections.FinishAsync(Site, next.Id, key.Sign(next.Challenge), default); Equal(1, approval.Calls);
        });
        await Case("pending challenge count, attempt rate and expiry cleanup remain bounded", async () =>
        {
            using var key = new Identity(); var clock = new Clock(); var pairing = new PairingState(clock);
            using var connections = new BrowserConnections(pairing, timeProvider: clock);
            for (int i = 0; i < 8; i++) connections.Start(Site, key.Id, Scope, Session, key.PublicKey);
            Throws("BUSY", () => connections.Start(Site, key.Id, Scope, Session, key.PublicKey));
            clock.Advance(TimeSpan.FromMinutes(3));
            for (int i = 0; i < 12; i++)
            {
                var attempt = connections.Start(Site, key.Id, Scope, Session, key.PublicKey);
                await Error("FORBIDDEN", () => connections.FinishAsync(Site, attempt.Id, Convert.ToBase64String(new byte[64]), default));
            }
            Throws("TOO_MANY_ATTEMPTS", () => connections.Start(Site, key.Id, Scope, Session, key.PublicKey));
            clock.Advance(TimeSpan.FromMinutes(1)); connections.Start(Site, key.Id, Scope, Session, key.PublicKey);
        });
        await Case("new connection preflight remains origin and header restricted", async () =>
        {
            await using var h = await Host.Create();
            using var allowed = new HttpRequestMessage(HttpMethod.Options, "/v2/connect/start");
            allowed.Headers.Add("Origin", Site); allowed.Headers.Add("Access-Control-Request-Method", "POST");
            allowed.Headers.Add("Access-Control-Request-Headers", "content-type");
            using var response = await h.Http.SendAsync(allowed); Equal(204, (int)response.StatusCode);
            using var bad = new HttpRequestMessage(HttpMethod.Options, "/v2/connect/finish");
            bad.Headers.Add("Origin", Site); bad.Headers.Add("Access-Control-Request-Method", "POST"); bad.Headers.Add("Access-Control-Request-Headers", "authorization");
            using var denied = await h.Http.SendAsync(bad); Equal(403, (int)denied.StatusCode);
        });
        return Passed;
    }

    static string Hex(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    static async Task Case(string name, Func<Task> test)
    {
        try { await test(); Passed.Add(name); Console.WriteLine("PASS " + name); }
        catch (Exception error) { throw new InvalidOperationException("FAIL " + name + ": " + error.Message, error); }
    }
    static void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    static void Equal<T>(T expected, T actual) => Check(EqualityComparer<T>.Default.Equals(expected, actual), $"Expected {expected}; got {actual}");
    static void Throws(string code, Action test)
    {
        try { test(); } catch (ConnectorException error) when (error.Code == code) { return; }
        throw new InvalidOperationException("Expected connector error " + code);
    }
    static async Task Error(string code, Func<Task> test)
    {
        try { await test(); } catch (ConnectorException error) when (error.Code == code) { return; }
        throw new InvalidOperationException("Expected connector error " + code);
    }
    sealed class Identity : IDisposable
    {
        readonly ECDsa key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        public string PublicKey => Convert.ToBase64String(key.ExportSubjectPublicKeyInfo());
        public string Id => Convert.ToHexString(SHA256.HashData(key.ExportSubjectPublicKeyInfo())).ToLowerInvariant();
        public object Body(string? scope = null, string? session = null) => new { clientId = Id, scope = scope ?? Scope, session = session ?? Session, publicKey = PublicKey };
        public string Sign(string challenge) => Convert.ToBase64String(key.SignData(Convert.FromBase64String(challenge), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
        public void Dispose() => key.Dispose();
    }
    sealed class Clock : TimeProvider
    {
        long ticks = new DateTimeOffset(2026, 11, 28, 0, 0, 0, TimeSpan.Zero).UtcTicks;
        public override DateTimeOffset GetUtcNow() => new(Interlocked.Read(ref ticks), TimeSpan.Zero);
        public void Advance(TimeSpan time) => Interlocked.Add(ref ticks, time.Ticks);
    }
    sealed class Store : IScannerTrustStore
    {
        readonly object gate = new(); readonly HashSet<ScannerTrustEntry> entries = [];
        public int Count { get { lock (gate) return entries.Count; } }
        public bool IsTrusted(ScannerTrustEntry entry) { lock (gate) return entries.Contains(entry); }
        public void Remember(ScannerTrustEntry entry) { lock (gate) entries.Add(entry); }
        public void Clear() { lock (gate) entries.Clear(); }
    }
    sealed class Approval : IScannerConnectionApproval
    {
        int calls; public int Calls => Volatile.Read(ref calls);
        public Func<ScannerConnectionRequest, CancellationToken, Task<ScannerConnectionDecision>> Handler { get; set; } = (_, _) => Task.FromResult(new ScannerConnectionDecision(true, true));
        public Task<ScannerConnectionDecision> ApproveAsync(ScannerConnectionRequest request, CancellationToken token) { Interlocked.Increment(ref calls); return Handler(request, token); }
    }
    sealed class Scanner : IScannerAdapter
    {
        public Task<IReadOnlyList<ScanDevice>> GetDevicesAsync(CancellationToken token) => Task.FromResult<IReadOnlyList<ScanDevice>>([new("generic-device", "가상 범용 스캐너", ["flatbed"])]);
        public Task<ScanImage> ScanAsync(ScanRequest request, CancellationToken token) => Task.FromResult(new ScanImage(ProtocolTests.SyntheticJpeg, 2, 2));
    }
    sealed record Challenge(string Id, string Nonce);
    sealed record Reply(int Status, JsonElement Json)
    {
        public string Text(string key) => Json.TryGetProperty(key, out var value) ? value.GetString() ?? "" : "";
    }
    sealed class Host : IAsyncDisposable
    {
        public Clock Clock { get; } = new(); public Store Store { get; } = new(); public Approval Approval { get; } = new(); public PairingState Pairing { get; }
        public HttpClient Http { get; } = new(); readonly WebApplication app;
        Host(int port) { Pairing = new(Clock); app = ConnectorHost.Create(new Scanner(), Pairing, new() { Port = port, TimeProvider = Clock, TrustStore = Store, ConnectionApproval = Approval }); }
        public static async Task<Host> Create(int port = 0)
        {
            var host = new Host(port); await host.app.StartAsync(); host.Http.BaseAddress = new Uri(host.app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()); return host;
        }
        public Task WaitForShutdown() => app.WaitForShutdownAsync();
        public async Task<Reply> Get(string path, string? token = null, string origin = Site) => await Request(HttpMethod.Get, path, token, origin);
        public async Task<Reply> Post(string path, object body, string? token = null, string origin = Site) => await Request(HttpMethod.Post, path, token, origin, JsonContent.Create(body));
        async Task<Reply> Request(HttpMethod method, string path, string? token, string origin, HttpContent? content = null)
        {
            using var request = new HttpRequestMessage(method, path) { Content = content }; request.Headers.Add("Origin", origin);
            if (token != null) request.Headers.Add("X-Snote-Scanner-Token", token);
            using var response = await Http.SendAsync(request); using var data = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync()); return new((int)response.StatusCode, data.RootElement.Clone());
        }
        public async Task<Challenge> Start(Identity key, string origin = Site, string? scope = null, string? session = null)
        {
            var response = await Post("/v2/connect/start", key.Body(scope, session), origin: origin); Equal(200, response.Status); return new(response.Text("id"), response.Text("challenge"));
        }
        public Task<Reply> Finish(Challenge challenge, Identity key, string origin = Site) => Post("/v2/connect/finish", new { id = challenge.Id, signature = key.Sign(challenge.Nonce) }, origin: origin);
        public async Task<string> Connect(Identity key, string origin = Site, string? scope = null, string? session = null)
        {
            var response = await Finish(await Start(key, origin, scope, session), key, origin); Equal(200, response.Status); return response.Text("token");
        }
        public async ValueTask DisposeAsync() { await app.StopAsync(); await app.DisposeAsync(); Http.Dispose(); }
    }
}
