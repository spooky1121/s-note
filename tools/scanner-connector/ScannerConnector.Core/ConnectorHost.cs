using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;

namespace Snote.ScannerConnector.Core;

public static class ConnectorHost
{
    public const int Protocol = 2;
    public const string Product = "snote-scanner-connector";
    public const string Version = "1.1.0";
    private static readonly HashSet<string> Origins = ["https://s-note.kr", "https://s-note.pages.dev"];
    private static readonly HashSet<string> CorsHeaders = ["content-type", "x-snote-scanner-token"];
    private static readonly HashSet<string> ErrorCodes = ["PAIRING_REQUIRED", "BAD_CODE", "BUSY", "NO_DEVICE", "DRIVER_ERROR", "SCAN_FAILED", "NO_PAPER", "NOT_FOUND", "EXPIRED", "CANCELLED", "INVALID_REQUEST", "FORBIDDEN", "CONNECTION_DENIED", "TOO_MANY_ATTEMPTS"];
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static WebApplication Create(IScannerAdapter adapter, PairingState pairing, ConnectorOptions? options = null)
    {
        options ??= new();
        if (options.Port is < 0 or > 65535) throw new ArgumentOutOfRangeException(nameof(options));
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [], ApplicationName = typeof(ConnectorHost).Assembly.FullName });
        // A downloaded helper must not load a neighbouring appsettings.json or
        // inherit an ASPNETCORE_* endpoint that changes its loopback binding.
        builder.Configuration.Sources.Clear();
        builder.Configuration.AddInMemoryCollection();
        builder.WebHost.PreferHostingUrls(false);
        // Do not log scanner identities, headers, capabilities, paths or images.
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(server =>
        {
            server.AddServerHeader = false;
            server.Listen(IPAddress.Loopback, options.Port, listen => listen.Protocols = HttpProtocols.Http1);
            server.Limits.MaxRequestBodySize = 4096;
            server.Limits.MaxRequestHeadersTotalSize = 8192;
            server.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(5);
            server.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(10);
            server.Limits.MaxConcurrentConnections = 16;
        });
        var app = builder.Build();
        var jobs = new ScanJobs(adapter, pairing, options.TimeProvider);
        var connections = new BrowserConnections(pairing, options.TrustStore, options.ConnectionApproval, options.TimeProvider);
        var timer = new System.Threading.Timer(_ => jobs.Sweep(), null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));
        app.Lifetime.ApplicationStopping.Register(() => { timer.Dispose(); connections.Dispose(); jobs.Dispose(); });
        app.Run(async context =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.Pragma = "no-cache";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            try
            {
                if (context.Request.Host.Host != "127.0.0.1" || context.Request.Host.Port != context.Connection.LocalPort ||
                    context.Connection.RemoteIpAddress is not { } remote || !IPAddress.IsLoopback(remote))
                    throw new ConnectorException("FORBIDDEN", 403);
                var origin = context.Request.Headers.Origin.ToString();
                if (!IsAllowedOrigin(origin)) throw new ConnectorException("FORBIDDEN", 403);
                var path = context.Request.Path.Value ?? "";
                var methods = Methods(path, options.AllowLegacyPairing);
                if (methods.Length == 0 || context.Request.QueryString.HasValue) throw new ConnectorException("NOT_FOUND", 404);
                context.Response.Headers.AccessControlAllowOrigin = origin;
                context.Response.Headers.Vary = "Origin, Access-Control-Request-Method, Access-Control-Request-Headers";
                context.Response.Headers.AccessControlExposeHeaders = "X-Snote-Scan-Id, Content-Length";
                if (context.Request.Method == "OPTIONS")
                {
                    var requested = context.Request.Headers.AccessControlRequestMethod.ToString();
                    var headers = context.Request.Headers.AccessControlRequestHeaders.ToString().Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
                    if (!methods.Contains(requested) || headers.Any(h => !CorsHeaders.Contains(h.ToLowerInvariant())) ||
                        context.Request.Headers["Access-Control-Request-Private-Network"].Count > 1 ||
                        context.Request.Headers["Access-Control-Request-Private-Network"].ToString() is not ("" or "true"))
                        throw new ConnectorException("FORBIDDEN", 403);
                    context.Response.Headers.AccessControlAllowMethods = requested;
                    context.Response.Headers.AccessControlAllowHeaders = string.Join(", ", headers);
                    context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
                    context.Response.Headers.AccessControlMaxAge = "300";
                    context.Response.StatusCode = 204;
                    return;
                }
                if (!methods.Contains(context.Request.Method)) throw new ConnectorException("INVALID_REQUEST", 405);
                if (path == "/v1/health")
                {
                    await Send(context, new { ok = true, product = Product, protocol = Protocol, version = Version, platform = "windows", capabilities = new[] { "browser-key-approval", "remembered-browser" } });
                    return;
                }
                if (path == "/v2/connect/start")
                {
                    using var body = await Read(context, ["clientId", "scope", "session", "publicKey"]);
                    var raw = body.RootElement;
                    var challenge = connections.Start(origin, String(raw, "clientId", 64), String(raw, "scope", 64),
                        String(raw, "session", 64), String(raw, "publicKey", 200));
                    await Send(context, new { ok = true, id = challenge.Id, challenge = challenge.Challenge, expiresAt = challenge.ExpiresAt });
                    return;
                }
                if (path == "/v2/connect/finish")
                {
                    using var body = await Read(context, ["id", "signature"]);
                    var raw = body.RootElement;
                    if (!Guid.TryParseExact(String(raw, "id", 36), "D", out var id) || id == Guid.Empty)
                        throw new ConnectorException("INVALID_REQUEST", 400);
                    var connection = await connections.FinishAsync(origin, id, String(raw, "signature", 88), context.RequestAborted);
                    await Send(context, new { ok = true, token = connection.Token, expiresAt = connection.ExpiresAt, remembered = connection.Remembered });
                    return;
                }
                if (path == "/v1/pair")
                {
                    using var body = await Read(context, ["code"]);
                    var code = String(body.RootElement, "code", 6);
                    var pair = pairing.Pair(code, origin);
                    await Send(context, new { ok = true, token = pair.Token, expiresAt = pair.ExpiresAt });
                    return;
                }
                if (context.Request.Headers["X-Snote-Scanner-Token"].Count != 1) throw new ConnectorException("PAIRING_REQUIRED", 401);
                var owner = pairing.Authenticate(context.Request.Headers["X-Snote-Scanner-Token"].ToString(), origin);
                if (path == "/v1/devices")
                {
                    var devices = await adapter.GetDevicesAsync(context.RequestAborted);
                    if (!pairing.IsCurrent(owner)) throw new ConnectorException("PAIRING_REQUIRED", 401);
                    if (devices.Count > 64 || devices.Select(d => d.Id).Distinct(StringComparer.Ordinal).Count() != devices.Count ||
                        devices.Any(d => !ValidText(d.Id, 512) || !ValidText(d.Name, 200) || d.Sources.Count is < 1 or > 2 ||
                            d.Sources.Distinct().Count() != d.Sources.Count || d.Sources.Any(s => s is not ("flatbed" or "feeder"))))
                        throw new ConnectorException("DRIVER_ERROR", 502);
                    await Send(context, new { ok = true, devices });
                    return;
                }
                if (path == "/v1/scans")
                {
                    using var body = await Read(context, ["id", "deviceId", "source", "dpi", "color"]);
                    var raw = body.RootElement;
                    if (!Guid.TryParseExact(String(raw, "id", 36), "D", out var id) || id == Guid.Empty ||
                        !raw.GetProperty("dpi").TryGetInt32(out var dpi) || dpi is not (150 or 200 or 300))
                        throw new ConnectorException("INVALID_REQUEST", 400);
                    var device = String(raw, "deviceId", 512);
                    var source = String(raw, "source", 8);
                    var color = String(raw, "color", 5);
                    if (source is not ("flatbed" or "feeder") || color is not ("color" or "gray" or "bw")) throw new ConnectorException("INVALID_REQUEST", 400);
                    var status = jobs.Start(new(id, device, source, dpi, color), owner);
                    await Send(context, new { ok = true, id = status.Id, state = status.State, code = status.Code }, 202);
                    return;
                }
                var parts = path.Split('/');
                var jobId = Guid.ParseExact(parts[3], "D");
                if (parts.Length == 5)
                {
                    var image = jobs.Image(jobId, owner);
                    context.Response.ContentType = "image/jpeg";
                    context.Response.ContentLength = image.Data.Length;
                    context.Response.Headers["X-Snote-Scan-Id"] = jobId.ToString("D");
                    await context.Response.Body.WriteAsync(image.Data, context.RequestAborted);
                    return;
                }
                var result = context.Request.Method == "DELETE" ? jobs.Cancel(jobId, owner) : jobs.Get(jobId, owner);
                await Send(context, new { ok = true, id = result.Id, state = result.State, code = result.Code });
            }
            catch (Exception error)
            {
                if (context.Response.HasStarted || context.RequestAborted.IsCancellationRequested) return;
                var known = error as ConnectorException;
                var code = known is not null && ErrorCodes.Contains(known.Code) ? known.Code :
                    error is JsonException or InvalidOperationException or Microsoft.AspNetCore.Http.BadHttpRequestException or OperationCanceledException ? "INVALID_REQUEST" : "DRIVER_ERROR";
                await Send(context, new { ok = false, code, error = Message(code) }, known?.StatusCode ?? code switch
                {
                    "PAIRING_REQUIRED" or "BAD_CODE" => 401,
                    "FORBIDDEN" or "CONNECTION_DENIED" => 403,
                    "TOO_MANY_ATTEMPTS" => 429,
                    "NOT_FOUND" => 404,
                    "BUSY" or "CANCELLED" => 409,
                    "EXPIRED" => 410,
                    "INVALID_REQUEST" => 400,
                    _ => 502
                });
            }
        });
        return app;
    }
    private static string[] Methods(string path, bool allowLegacyPairing)
    {
        if (path is "/v1/health" or "/v1/devices") return ["GET"];
        if (path == "/v1/pair") return allowLegacyPairing ? ["POST"] : [];
        if (path is "/v1/scans" or "/v2/connect/start" or "/v2/connect/finish") return ["POST"];
        var parts = path.Split('/');
        if (parts.Length is not (4 or 5) || parts[1] != "v1" || parts[2] != "scans" ||
            !Guid.TryParseExact(parts[3], "D", out var id) || id == Guid.Empty) return [];
        if (parts.Length == 5) return parts[4] == "image" ? ["GET"] : [];
        return ["GET", "DELETE"];
    }
    internal static bool IsAllowedOrigin(string origin) => Origins.Contains(origin);
    private static bool ValidText(string value, int max) => !string.IsNullOrWhiteSpace(value) && value.Length <= max && !value.Any(char.IsControl);
    private static string String(JsonElement root, string key, int max)
    {
        var value = root.GetProperty(key);
        if (value.ValueKind != JsonValueKind.String || !ValidText(value.GetString()!, max)) throw new ConnectorException("INVALID_REQUEST", 400);
        return value.GetString()!;
    }
    private static async Task<JsonDocument> Read(HttpContext context, string[] keys)
    {
        if (context.Request.ContentType?.Split(';')[0].Trim() != "application/json" ||
            context.Request.Headers.ContentEncoding.Count != 0 || context.Request.ContentLength > 4096)
            throw new ConnectorException("INVALID_REQUEST", 400);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        using var stream = new MemoryStream();
        var buffer = new byte[1024];
        while (true)
        {
            var count = await context.Request.Body.ReadAsync(buffer, timeout.Token);
            if (count == 0) break;
            if (stream.Length + count > 4096) throw new ConnectorException("INVALID_REQUEST", 400);
            stream.Write(buffer, 0, count);
        }
        var body = JsonDocument.Parse(stream.ToArray(), new JsonDocumentOptions { MaxDepth = 4 });
        var root = body.RootElement;
        if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Count() != keys.Length || keys.Any(key => !root.TryGetProperty(key, out _)))
        { body.Dispose(); throw new ConnectorException("INVALID_REQUEST", 400); }
        return body;
    }
    private static Task Send(HttpContext context, object value, int status = 200)
    {
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(value, Json, cancellationToken: context.RequestAborted);
    }
    private static string Message(string code) => code switch
    {
        "PAIRING_REQUIRED" => "웹에서 스캔을 다시 눌러 PC 연결을 확인해 주세요.",
        "BAD_CODE" => "PC 연결 도우미의 연결코드를 확인해 주세요.",
        "CONNECTION_DENIED" => "PC 연결 도우미에서 연결을 허용해 주세요.",
        "TOO_MANY_ATTEMPTS" => "연결 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
        "BUSY" => "스캐너가 처리 중입니다. 작업이 끝난 뒤 다시 시도해 주세요.",
        "NO_DEVICE" => "스캐너를 찾지 못했습니다. 전원·Wi-Fi·스캔 드라이버를 확인해 주세요.",
        "NO_PAPER" => "스캔할 원고를 넣어 주세요.",
        "CANCELLED" => "스캔 결과를 닫았습니다.",
        "EXPIRED" => "스캔 이미지가 만료되었습니다. 다시 스캔해 주세요.",
        "INVALID_REQUEST" => "스캔 설정과 연결 프로그램 버전을 확인해 주세요.",
        "FORBIDDEN" => "S-NOTE 페이지에서 다시 연결해 주세요.",
        "NOT_FOUND" => "스캔 작업을 다시 확인해 주세요.",
        _ => "스캔하지 못했습니다. 스캔 드라이버와 복합기 상태를 확인해 주세요."
    };
}
