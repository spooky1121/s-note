using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Snote.ScannerConnector.Core;

// Generated device/image data only. The production WIA adapter is never used.
if (args.Contains("--serve", StringComparer.Ordinal)) await ProtocolTests.ServeAsync();
else await ProtocolTests.RunAsync();

static class ProtocolTests
{
    const string Site = "https://s-note.kr";
    const string AlternateSite = "https://s-note.pages.dev";
    static readonly List<string> Passed = [];

    // Browser wire tests may launch this test assembly. It never loads WIA and
    // is not referenced or packaged by the production Windows project.
    public static async Task ServeAsync()
    {
        await using var h = await Harness.Create(17426);
        h.Clock.Advance(DateTimeOffset.UtcNow - h.Clock.GetUtcNow());
        Console.WriteLine("SNOTE_SYNTHETIC_SCANNER_READY " + JsonSerializer.Serialize(new { code = h.Pairing.CurrentCode, address = h.Address.ToString(), actualWiaUsed = false }));
        await h.WaitForShutdown();
    }

    public static async Task RunAsync()
    {
        await ExternalConfigurationCannotChangeBinding();
        await Case("health exposes only bounded protocol metadata", async h =>
        {
            var r = await h.Get("/v1/health");
            Equal(200, r.Status); Equal("snote-scanner-connector", r.Text("product"));
            Equal(1, r.Json.GetProperty("protocol").GetInt32());
            Equal(Site, r.Header("Access-Control-Allow-Origin"));
            Check(!r.Raw.Contains(h.Pairing.CurrentCode, StringComparison.Ordinal), "Pair code leaked in health");
            Check(!r.Json.TryGetProperty("devices", out _), "Unpaired health exposed devices");
            Check(r.Header("Cache-Control").Contains("no-store"), "Health was cacheable");
        });
        await Case("missing, null, foreign and lookalike origins are denied", async h =>
        {
            foreach (var origin in new string?[] { null, "null", "http://s-note.kr", "https://evil.invalid", "https://s-note.kr.evil.invalid", "https://s-note.kr/" })
            {
                var r = await h.Get("/v1/health", origin: origin);
                Equal(403, r.Status); Check(r.Header("Access-Control-Allow-Origin") == "", "Invalid origin gained CORS");
            }
        });
        await Case("Host cannot be rebound or omit the actual loopback port", async h =>
        {
            foreach (var host in new[] { "evil.invalid", "s-note.kr", "127.0.0.1" })
                Equal(403, (await h.Get("/v1/health", host: host)).Status);
        });
        await Case("validated private-network preflight is narrow", async h =>
        {
            var good = await h.Request(HttpMethod.Options, "/v1/scans", headers: new() { ["Access-Control-Request-Method"] = "POST", ["Access-Control-Request-Headers"] = "content-type,x-snote-scanner-token", ["Access-Control-Request-Private-Network"] = "true" });
            Check(good.Status is 200 or 204, "Known preflight denied");
            Equal(Site, good.Header("Access-Control-Allow-Origin")); Equal("true", good.Header("Access-Control-Allow-Private-Network"));
            Check(good.Header("Access-Control-Allow-Headers") != "*", "Wildcard preflight headers");
            var bad = await h.Request(HttpMethod.Options, "/v1/scans", headers: new() { ["Access-Control-Request-Method"] = "POST", ["Access-Control-Request-Headers"] = "authorization" });
            Equal(403, bad.Status);
            Equal(403, (await h.Request(HttpMethod.Options, "/v1/scans", origin: "https://evil.invalid", headers: new() { ["Access-Control-Request-Method"] = "POST" })).Status);
        });
        await Case("pairing code is one-use; token has bounded explicit expiry", async h =>
        {
            string old = h.Pairing.CurrentCode;
            string token = await h.Pair();
            Check(token.Length == 64 && token.All(Uri.IsHexDigit), "Unexpected capability format");
            Check(h.Pairing.CurrentCode != old, "Consumed pair code did not rotate");
            var reused = await h.Post("/v1/pair", new { code = old });
            Check(reused.Status >= 400, "Consumed pair code accepted");
            Equal(200, (await h.Get("/v1/devices", token)).Status);
        });
        await Case("wrong pairing codes are rate limited", async h =>
        {
            string wrong = h.Pairing.CurrentCode == "000000" ? "999999" : "000000";
            bool limited = false;
            for (int i = 0; i < 20; i++) limited |= (await h.Post("/v1/pair", new { code = wrong })).Status == 429;
            Check(limited, "Pairing guesses never rate limited");
        });
        await Case("unpaired commands and cross-origin capabilities are denied", async h =>
        {
            Check((await h.Get("/v1/devices")).Status >= 400, "Unpaired device list returned");
            string token = await h.Pair();
            Check((await h.Get("/v1/devices", token, origin: AlternateSite)).Status >= 400, "Capability reused across origins");
            Equal(200, (await h.Get("/v1/devices", token)).Status);
        });
        await Case("both explicitly allowed origins can pair independently", async h =>
        {
            string a = await h.Pair();
            string b = await h.Pair(AlternateSite);
            Equal(200, (await h.Get("/v1/devices", a)).Status);
            Equal(200, (await h.Get("/v1/devices", b, origin: AlternateSite)).Status);
            Check(a != b, "Different origins share capability");
        });
        await Case("malformed, excessive and unknown scan inputs fail before hardware", async h =>
        {
            string token = await h.Pair();
            var id = Guid.NewGuid();
            foreach (object body in new object[] {
                new { id, deviceId = "fake-device", source = "flatbed", dpi = 600, color = "color" },
                new { id, deviceId = "fake-device", source = "arbitrary", dpi = 300, color = "color" },
                new { id, deviceId = "fake-device", source = "flatbed", dpi = 300, color = "arbitrary" },
                new { id, deviceId = "fake-device", source = "flatbed", dpi = 300, color = "color", extra = true },
                new { id = "not-a-uuid", deviceId = "fake-device", source = "flatbed", dpi = 300, color = "color" },
                new { id, deviceId = "", source = "flatbed", dpi = 300, color = "color" }
            }) Check((await h.Post("/v1/scans", body, token)).Status >= 400, "Invalid input accepted");
            var malformed = await h.Request(HttpMethod.Post, "/v1/scans", token: token, content: new StringContent("{bad", Encoding.UTF8, "application/json"));
            Check(malformed.Status >= 400, "Malformed JSON accepted");
            var excessive = await h.Request(HttpMethod.Post, "/v1/scans", token: token, content: new StringContent(new string('x', 20_000), Encoding.UTF8, "application/json"));
            Check(excessive.Status >= 400, "Oversized JSON accepted");
            Equal(0, h.Adapter.Calls);
        });
        await Case("missing device or unsupported source never starts acquisition", async h =>
        {
            string token = await h.Pair();
            Guid absent = Guid.NewGuid();
            Equal(202, (await h.Post("/v1/scans", Body(absent, device: "not-installed"), token)).Status);
            var absentState = await h.Final(absent, token); Equal("failed", absentState.Text("state")); Equal("NO_DEVICE", absentState.Code);
            h.Adapter.Devices = [new("fake-device", "가상 스캐너", ["flatbed"])];
            Guid unsupported = Guid.NewGuid();
            Equal(202, (await h.Post("/v1/scans", Body(unsupported, source: "feeder"), token)).Status);
            var unsupportedState = await h.Final(unsupported, token); Equal("failed", unsupportedState.Text("state")); Equal("NO_DEVICE", unsupportedState.Code);
            Equal(0, h.Adapter.Calls);
        });
        await Case("same request UUID retries acquire exactly once", async h =>
        {
            string token = await h.Pair(); Guid id = Guid.NewGuid(); h.Adapter.Hold = true;
            Equal(202, (await h.Post("/v1/scans", Body(id), token)).Status);
            await Until(() => h.Adapter.Calls == 1);
            Check((await h.Post("/v1/scans", Body(id), token)).Status is 200 or 202, "Exact retry rejected");
            Equal(1, h.Adapter.Calls);
            Check((await h.Post("/v1/scans", Body(id, dpi: 150), token)).Status >= 400, "UUID reused with another fingerprint");
            Equal(1, h.Adapter.Calls); h.Adapter.Release();
            await h.Complete(id, token);
            Check((await h.Post("/v1/scans", Body(id), token)).Status is 200 or 202, "Completed exact retry rejected");
            Equal(1, h.Adapter.Calls);
        });
        await Case("one physical acquisition globally; another job is busy", async h =>
        {
            string token = await h.Pair(); Guid id = Guid.NewGuid(); h.Adapter.Hold = true;
            Equal(202, (await h.Post("/v1/scans", Body(id), token)).Status); await Until(() => h.Adapter.Calls == 1);
            var busy = await h.Post("/v1/scans", Body(Guid.NewGuid()), token);
            Equal(409, busy.Status); Equal("BUSY", busy.Code); Equal(1, h.Adapter.Calls);
            h.Adapter.Release(); await h.Complete(id, token);
        });
        await Case("successful image is JPEG, bounded, no-store and exact-job tagged", async h =>
        {
            string token = await h.Pair(); Guid id = Guid.NewGuid();
            Equal(202, (await h.Post("/v1/scans", Body(id), token)).Status); await h.Complete(id, token);
            var image = await h.Get($"/v1/scans/{id}/image", token);
            Equal(200, image.Status); Check(image.Header("Content-Type").StartsWith("image/jpeg"), "Wrong scan MIME");
            Equal(id.ToString(), image.Header("X-Snote-Scan-Id")); Check(image.Header("Cache-Control").Contains("no-store"), "Private scan cacheable");
            Check(image.Bytes.SequenceEqual(FakeScanner.Jpeg), "Acquired bytes changed");
        });
        await Case("a second pairing cannot read or cancel the first scan", async h =>
        {
            string a = await h.Pair(); Guid id = Guid.NewGuid();
            Equal(202, (await h.Post("/v1/scans", Body(id), a)).Status); await h.Complete(id, a);
            string b = await h.Pair();
            Check((await h.Get($"/v1/scans/{id}", b)).Status >= 400, "Cross-capability status leaked");
            Check((await h.Get($"/v1/scans/{id}/image", b)).Status >= 400, "Cross-capability image leaked");
            Check((await h.Request(HttpMethod.Delete, $"/v1/scans/{id}", token: b)).Status >= 400, "Cross-capability cancellation accepted");
            Equal(200, (await h.Get($"/v1/scans/{id}/image", a)).Status);
        });
        await Case("cancel retains native busy until actual acquisition exits", async h =>
        {
            string token = await h.Pair(); Guid id = Guid.NewGuid(); h.Adapter.Hold = true;
            Equal(202, (await h.Post("/v1/scans", Body(id), token)).Status); await Until(() => h.Adapter.Calls == 1);
            Equal(200, (await h.Request(HttpMethod.Delete, $"/v1/scans/{id}", token: token)).Status);
            var busy = await h.Post("/v1/scans", Body(Guid.NewGuid()), token); Equal(409, busy.Status); Equal("BUSY", busy.Code);
            h.Adapter.Release(); await Until(async () => (await h.Get($"/v1/scans/{id}", token)).Text("state") == "cancelled");
            Check((await h.Get($"/v1/scans/{id}/image", token)).Status >= 400, "Cancelled scan bytes survived");
            Check((await h.Post("/v1/scans", Body(id), token)).Status >= 400 || h.Adapter.Calls == 1, "Cancelled UUID physically rescanned");
            Equal(1, h.Adapter.Calls);
        });
        await Case("cancelling during enumeration never starts a later physical scan", async h =>
        {
            string token = await h.Pair(); Guid id = Guid.NewGuid(); h.Adapter.HoldEnumeration = true;
            Equal(202, (await h.Post("/v1/scans", Body(id), token)).Status); await Until(() => h.Adapter.EnumerationStarted);
            Equal(200, (await h.Request(HttpMethod.Delete, $"/v1/scans/{id}", token: token)).Status);
            h.Adapter.ReleaseEnumeration();
            Guid next = Guid.NewGuid();
            await Until(async () => (await h.Post("/v1/scans", Body(next), token)).Status == 202);
            await h.Complete(next, token); Equal(1, h.Adapter.Calls);
            Equal("cancelled", (await h.Get($"/v1/scans/{id}", token)).Text("state"));
        });
        await Case("capability expiry during enumeration prevents late acquisition", async h =>
        {
            string token = await h.Pair(); Guid id = Guid.NewGuid(); h.Adapter.HoldEnumeration = true;
            Equal(202, (await h.Post("/v1/scans", Body(id), token)).Status); await Until(() => h.Adapter.EnumerationStarted);
            h.Clock.Advance(TimeSpan.FromHours(13));
            Check((await h.Get("/v1/devices", token)).Status >= 400, "Expired capability remains usable");
            h.Adapter.ReleaseEnumeration();
            string fresh = await h.Pair(); Guid next = Guid.NewGuid();
            await Until(async () => (await h.Post("/v1/scans", Body(next), fresh)).Status == 202);
            await h.Complete(next, fresh); Equal(1, h.Adapter.Calls);
        });
        await Case("deleted completed images cannot be revived by delayed retry", async h =>
        {
            string token = await h.Pair(); Guid id = Guid.NewGuid();
            Equal(202, (await h.Post("/v1/scans", Body(id), token)).Status); await h.Complete(id, token);
            Equal(200, (await h.Request(HttpMethod.Delete, $"/v1/scans/{id}", token: token)).Status);
            Check((await h.Get($"/v1/scans/{id}/image", token)).Status >= 400, "Deleted bytes remain accessible");
            await h.Post("/v1/scans", Body(id), token); Equal(1, h.Adapter.Calls);
        });
        await Case("expired image UUID is spent instead of rescanning", async h =>
        {
            string token = await h.Pair(); Guid id = Guid.NewGuid();
            Equal(202, (await h.Post("/v1/scans", Body(id), token)).Status); await h.Complete(id, token);
            h.Clock.Advance(TimeSpan.FromMinutes(6));
            Check((await h.Get($"/v1/scans/{id}/image", token)).Status >= 400, "Expired private bytes accessible");
            await h.Post("/v1/scans", Body(id), token); Equal(1, h.Adapter.Calls);
        });
        await Case("expired capability cannot command or read a device", async h =>
        {
            string token = await h.Pair(); h.Clock.Advance(TimeSpan.FromHours(13));
            Check((await h.Get("/v1/devices", token)).Status >= 400, "Expired capability accepted");
            Check((await h.Post("/v1/scans", Body(Guid.NewGuid()), token)).Status >= 400, "Expired capability scanned"); Equal(0, h.Adapter.Calls);
        });
        await Case("unsafe adapter output fails without exposing image bytes", async h =>
        {
            string token = await h.Pair();
            foreach (var bad in new[] { new ScanImage(new byte[5 * 1024 * 1024 + 1], 2, 2), new ScanImage(FakeScanner.Jpeg, int.MaxValue, int.MaxValue), new ScanImage(FakeScanner.Jpeg, 0, 2), new ScanImage(FakeScanner.Jpeg, 2, 2, "text/html") })
            {
                h.Adapter.Output = bad; Guid id = Guid.NewGuid();
                Equal(202, (await h.Post("/v1/scans", Body(id), token)).Status);
                var state = await h.Final(id, token); Equal("failed", state.Text("state"));
                Check((await h.Get($"/v1/scans/{id}/image", token)).Status >= 400, "Unsafe native output served");
            }
        });
        await Case("adapter exceptions are sanitized and a later scan can recover", async h =>
        {
            string token = await h.Pair(); h.Adapter.Error = new InvalidOperationException("SYNTHETIC_PRIVATE_PATH_AND_TOKEN_MUST_NOT_LEAK"); Guid id = Guid.NewGuid();
            Equal(202, (await h.Post("/v1/scans", Body(id), token)).Status); var state = await h.Final(id, token);
            Equal("failed", state.Text("state")); Check(!state.Raw.Contains("SYNTHETIC_PRIVATE_PATH"), "Raw native error leaked");
            h.Adapter.Error = null; Guid next = Guid.NewGuid(); Equal(202, (await h.Post("/v1/scans", Body(next), token)).Status); await h.Complete(next, token);
        });
        string output = Environment.GetEnvironmentVariable("SCANNER_CONNECTOR_TEST_RECEIPT") ?? "/workspace/work/scanner-device-v2250/native-protocol-tests.json";
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
        await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { ok = true, syntheticOnly = true, actualWiaUsed = false, productionRequests = 0, passed = Passed.Count, cases = Passed }, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine($"PASS: {Passed.Count} independent native protocol groups");
    }

    static object Body(Guid id, string device = "fake-device", string source = "flatbed", int dpi = 300, string color = "color") => new { id, deviceId = device, source, dpi, color };
    static async Task ExternalConfigurationCannotChangeBinding()
    {
        const string name = "external appsettings and ASPNETCORE variables cannot add a non-loopback listener";
        string previousDirectory = Environment.CurrentDirectory;
        string directory = Path.Combine(Path.GetTempPath(), "snote-connector-config-" + Guid.NewGuid().ToString("N"));
        string[] names = ["ASPNETCORE_URLS", "ASPNETCORE_HTTP_PORTS", "ASPNETCORE_Kestrel__Endpoints__Unsafe__Url"];
        var previous = names.ToDictionary(n => n, Environment.GetEnvironmentVariable);
        Directory.CreateDirectory(directory);
        try
        {
            await File.WriteAllTextAsync(Path.Combine(directory, "appsettings.json"), "{\"Kestrel\":{\"Endpoints\":{\"Unsafe\":{\"Url\":\"http://0.0.0.0:0\"}}}}");
            Environment.CurrentDirectory = directory;
            Environment.SetEnvironmentVariable(names[0], "http://0.0.0.0:0");
            Environment.SetEnvironmentVariable(names[1], "45678");
            Environment.SetEnvironmentVariable(names[2], "http://0.0.0.0:0");
            await using var h = await Harness.Create();
            Equal("127.0.0.1", h.Address.Host);
            Equal(200, (await h.Get("/v1/health")).Status);
            Passed.Add(name); Console.WriteLine("PASS " + name);
        }
        catch (Exception e) { throw new InvalidOperationException("FAIL " + name + ": " + e.Message, e); }
        finally
        {
            Environment.CurrentDirectory = previousDirectory;
            foreach (var item in previous) Environment.SetEnvironmentVariable(item.Key, item.Value);
            Directory.Delete(directory, true);
        }
    }
    static async Task Case(string name, Func<Harness, Task> test)
    {
        await using var h = await Harness.Create();
        try { await test(h); Passed.Add(name); Console.WriteLine("PASS " + name); }
        catch (Exception e) { throw new InvalidOperationException("FAIL " + name + ": " + e.Message, e); }
    }
    static void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    static void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new InvalidOperationException($"Expected {expected}; got {actual}"); }
    static async Task Until(Func<bool> predicate) => await Until(() => Task.FromResult(predicate()));
    static async Task Until(Func<Task<bool>> predicate) { for (int i = 0; i < 300; i++) { if (await predicate()) return; await Task.Delay(10); } throw new TimeoutException("Synthetic job did not settle"); }

    sealed class Harness : IAsyncDisposable
    {
        public FakeClock Clock { get; } = new();
        public FakeScanner Adapter { get; } = new();
        public PairingState Pairing { get; }
        readonly WebApplication _app;
        readonly HttpClient _http;
        public Uri Address => _http.BaseAddress!;
        Harness(int port) { Pairing = new PairingState(Clock); _app = ConnectorHost.Create(Adapter, Pairing, new ConnectorOptions { Port = port, TimeProvider = Clock }); _http = new(); }
        public static async Task<Harness> Create(int port = 0)
        {
            var h = new Harness(port); await h._app.StartAsync();
            string address = h._app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
            h._http.BaseAddress = new Uri(address); return h;
        }
        public Task<Result> Get(string path, string? token = null, string? origin = Site, string? host = null) => Request(HttpMethod.Get, path, token: token, origin: origin, host: host);
        public Task<Result> Post(string path, object body, string? token = null, string? origin = Site) => Request(HttpMethod.Post, path, token: token, origin: origin, content: JsonContent.Create(body));
        public async Task<Result> Request(HttpMethod method, string path, string? token = null, string? origin = Site, string? host = null, HttpContent? content = null, Dictionary<string, string>? headers = null)
        {
            using var req = new HttpRequestMessage(method, path) { Content = content };
            if (origin != null) req.Headers.Add("Origin", origin);
            if (token != null) req.Headers.Add("X-Snote-Scanner-Token", token);
            if (host != null) req.Headers.Host = host;
            if (headers != null) foreach (var h in headers) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
            using var response = await _http.SendAsync(req);
            byte[] data = await response.Content.ReadAsByteArrayAsync();
            var resultHeaders = response.Headers.Concat(response.Content.Headers).ToDictionary(p => p.Key, p => string.Join(",", p.Value), StringComparer.OrdinalIgnoreCase);
            string raw = Encoding.UTF8.GetString(data); JsonElement json = default;
            if (response.Content.Headers.ContentType?.MediaType == "application/json") using (var parsed = JsonDocument.Parse(data)) json = parsed.RootElement.Clone();
            return new((int)response.StatusCode, json, raw, data, resultHeaders);
        }
        public async Task<string> Pair(string origin = Site)
        {
            var response = await Post("/v1/pair", new { code = Pairing.CurrentCode }, origin: origin);
            Equal(200, response.Status);
            Check(DateTimeOffset.TryParse(response.Text("expiresAt"), out var expires) && expires > Clock.GetUtcNow() && expires <= Clock.GetUtcNow().AddHours(13), "Unbounded capability expiry");
            return response.Text("token");
        }
        public async Task<Result> Final(Guid id, string token)
        {
            Result? result = null; await Until(async () => { result = await Get($"/v1/scans/{id}", token); return result.Text("state") is "complete" or "failed" or "cancelled"; }); return result!;
        }
        public async Task Complete(Guid id, string token) => Equal("complete", (await Final(id, token)).Text("state"));
        public Task WaitForShutdown() => _app.WaitForShutdownAsync();
        public async ValueTask DisposeAsync() { Adapter.Release(); Adapter.ReleaseEnumeration(); await _app.StopAsync(); await _app.DisposeAsync(); _http.Dispose(); }
    }
    sealed record Result(int Status, JsonElement Json, string Raw, byte[] Bytes, Dictionary<string, string> Headers)
    {
        public string Text(string name) => Json.ValueKind == JsonValueKind.Object && Json.TryGetProperty(name, out var value) ? value.GetString() ?? "" : "";
        public string Code => Text("code");
        public string Header(string name) => Headers.GetValueOrDefault(name, "");
    }
    sealed class FakeClock : TimeProvider
    {
        long _ticks = new DateTimeOffset(2026, 11, 27, 0, 0, 0, TimeSpan.Zero).UtcTicks;
        public override DateTimeOffset GetUtcNow() => new(Interlocked.Read(ref _ticks), TimeSpan.Zero);
        public void Advance(TimeSpan span) => Interlocked.Add(ref _ticks, span.Ticks);
    }
    sealed class FakeScanner : IScannerAdapter
    {
        public static readonly byte[] Jpeg = Convert.FromBase64String("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==");
        public IReadOnlyList<ScanDevice> Devices { get; set; } = [new("fake-device", "가상 SL-J3560FW", ["flatbed", "feeder"])];
        public ScanImage Output { get; set; } = new(Jpeg, 2, 2);
        public Exception? Error { get; set; }
        public bool Hold { get; set; }
        public bool HoldEnumeration { get; set; }
        public volatile bool EnumerationStarted;
        int _calls;
        public int Calls => Volatile.Read(ref _calls);
        readonly TaskCompletionSource _released = new(TaskCreationOptions.RunContinuationsAsynchronously);
        readonly TaskCompletionSource _enumerationReleased = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<IReadOnlyList<ScanDevice>> GetDevicesAsync(CancellationToken cancellationToken)
        {
            EnumerationStarted = true;
            if (HoldEnumeration) await _enumerationReleased.Task;
            return Devices;
        }
        public async Task<ScanImage> ScanAsync(ScanRequest request, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _calls);
            if (Hold) await _released.Task; // Intentionally emulate a native transfer that cannot be interrupted.
            if (Error != null) throw Error;
            return Output;
        }
        public void Release() => _released.TrySetResult();
        public void ReleaseEnumeration() => _enumerationReleased.TrySetResult();
    }
}
