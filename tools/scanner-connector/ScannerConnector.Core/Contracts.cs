namespace Snote.ScannerConnector.Core;

public sealed record ScanDevice(string Id, string Name, IReadOnlyList<string> Sources);
public sealed record ScanRequest(Guid Id, string DeviceId, string Source, int Dpi, string Color);
public sealed record ScanImage(byte[] Data, int Width, int Height, string MimeType = "image/jpeg");
public interface IScannerAdapter
{
    Task<IReadOnlyList<ScanDevice>> GetDevicesAsync(CancellationToken cancellationToken);
    Task<ScanImage> ScanAsync(ScanRequest request, CancellationToken cancellationToken);
}
public sealed class ConnectorException(string code, int? statusCode = null) : Exception(code)
{
    public string Code { get; } = code;
    public int? StatusCode { get; } = statusCode;
}
public sealed class ConnectorOptions
{
    public int Port { get; init; } = 17426;
    public TimeProvider TimeProvider { get; init; } = TimeProvider.System;
}
