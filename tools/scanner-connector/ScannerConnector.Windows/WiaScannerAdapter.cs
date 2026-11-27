using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Snote.ScannerConnector.Core;

namespace Snote.ScannerConnector.Windows;

/// <summary>
/// Every WIA object lives and is released on one STA thread. A cancelled HTTP
/// request never completes a running COM transfer early or starts another one.
/// No COM exception, device identifier or scanned byte is written to a log.
/// </summary>
public sealed class WiaScannerAdapter : IScannerAdapter, IDisposable
{
    // Request lossless BMP; WIA may use the device's preferred format if it
    // cannot supply BMP. Acquire once: retrying could feed another paper page.
    private const string BitmapFormat = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}";
    private const string FlatbedCategory = "FB607B1F-43F3-488B-855B-FB703EC342A6";
    private const string FeederCategory = "FE131934-F84C-42AD-8DA4-6129CDDD7288";
    private const int MaxPixels = 40_000_000, MaxImageBytes = 5 * 1024 * 1024;
    private readonly BlockingCollection<Action> _work = new(8);
    private readonly Thread _thread;
    private int _disposed;

    public WiaScannerAdapter()
    {
        _thread = new Thread(Work) { IsBackground = true, Name = "S-NOTE WIA" };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
    }

    public Task<IReadOnlyList<ScanDevice>> GetDevicesAsync(CancellationToken token) =>
        Enqueue(() => Enumerate(token), token);

    public Task<ScanImage> ScanAsync(ScanRequest request, CancellationToken token) =>
        Enqueue(() => Acquire(request, token), token);

    private Task<T> Enqueue<T>(Func<T> operation, CancellationToken token)
    {
        if (Volatile.Read(ref _disposed) != 0) return Task.FromException<T>(new ConnectorException("CANCELLED"));
        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            if (!_work.TryAdd(() =>
            {
                try
                {
                    token.ThrowIfCancellationRequested();
                    var result = operation();
                    if (token.IsCancellationRequested)
                    {
                        if (result is ScanImage image) CryptographicOperations.ZeroMemory(image.Data);
                        throw new ConnectorException("CANCELLED");
                    }
                    completion.TrySetResult(result);
                }
                catch (Exception error) { completion.TrySetException(SafeError(error)); }
            })) completion.TrySetException(new ConnectorException("BUSY"));
        }
        catch (InvalidOperationException) { completion.TrySetException(new ConnectorException("CANCELLED")); }
        return completion.Task;
    }

    private void Work()
    {
        foreach (var action in _work.GetConsumingEnumerable()) action();
    }

    private static IReadOnlyList<ScanDevice> Enumerate(CancellationToken token)
    {
        using var scope = new ComScope();
        dynamic manager = scope.Add(CreateManager());
        dynamic infos = scope.Add(manager.DeviceInfos);
        var count = Math.Min((int)infos.Count, 64);
        var result = new List<ScanDevice>();
        var scannerSeen = false;
        for (var i = 1; i <= count; i++)
        {
            token.ThrowIfCancellationRequested();
            dynamic info = scope.Add(infos[i]);
            if ((int)info.Type != 1) continue;
            scannerSeen = true;
            string id = Convert.ToString((object)info.DeviceID) ?? "";
            if (id.Length is < 1 or > 512 || id.Any(char.IsControl)) continue;
            try
            {
                dynamic device = scope.Add(info.Connect());
                var items = Items(scope, (object)device);
                var sources = Sources(scope, (object)device, items);
                if (sources.Count == 0) continue;
                dynamic properties = scope.Add(info.Properties);
                string name = Convert.ToString(ReadProperty(scope, (object)properties, 7)) ?? "Windows 스캐너";
                name = new string(name.Where(c => !char.IsControl(c)).Take(200).ToArray()).Trim();
                result.Add(new ScanDevice(id, string.IsNullOrWhiteSpace(name) ? "Windows 스캐너" : name, sources));
            }
            catch (OperationCanceledException) { throw; }
            catch { /* An offline device must not prevent another installed scanner. */ }
        }
        if (result.Count == 0 && scannerSeen) throw new ConnectorException("DRIVER_ERROR");
        return result;
    }

    private static ScanImage Acquire(ScanRequest request, CancellationToken token)
    {
        if (request.Dpi is not (150 or 200 or 300) || request.Source is not ("flatbed" or "feeder") || request.Color is not ("color" or "gray" or "bw"))
            throw new ConnectorException("INVALID_REQUEST");
        using var scope = new ComScope();
        dynamic manager = scope.Add(CreateManager());
        dynamic infos = scope.Add(manager.DeviceInfos);
        object? chosen = null;
        for (var i = 1; i <= Math.Min((int)infos.Count, 64); i++)
        {
            token.ThrowIfCancellationRequested();
            dynamic info = scope.Add(infos[i]);
            if ((int)info.Type == 1 && string.Equals(Convert.ToString(info.DeviceID), request.DeviceId, StringComparison.Ordinal)) { chosen = info; break; }
        }
        if (chosen is null) throw new ConnectorException("NO_DEVICE");
        dynamic device = scope.Add(((dynamic)chosen).Connect());
        var items = Items(scope, (object)device);
        var available = Sources(scope, (object)device, items);
        if (!available.Contains(request.Source)) throw new ConnectorException("DRIVER_ERROR");
        object? target = null;
        foreach (dynamic candidate in items)
        {
            if (Category(scope, (object)candidate) == (request.Source == "flatbed" ? FlatbedCategory : FeederCategory)) { target = candidate; break; }
        }
        var legacy = target is null;
        if (legacy)
        {
            // WIA Automation also exposes older drivers through a single child
            // item. Select its root source before reading item settings.
            dynamic rootProperties = scope.Add(device.Properties);
            var selector = ReadProperty(scope, (object)rootProperties, 3088);
            if ((selector is not null || request.Source == "feeder") && !WriteProperty(scope, (object)rootProperties, 3088, request.Source == "feeder" ? 1 : 2))
                throw new ConnectorException("DRIVER_ERROR");
            target = Items(scope, (object)device).FirstOrDefault();
        }
        if (target is null) throw new ConnectorException("NO_DEVICE");
        dynamic selected = target;
        dynamic properties = scope.Add(selected.Properties);
        if (!legacy && request.Source == "feeder")
        {
            // A source retaining a previous duplex setting must never silently
            // run two physical sides for this single-page operation.
            if (!WriteProperty(scope, (object)properties, 3088, 0x20) || (Convert.ToInt32(ReadProperty(scope, (object)properties, 3088)) & 4) != 0)
                throw new ConnectorException("DRIVER_ERROR");
        }
        if (ReadProperty(scope, (object)properties, 3096) is not null && (!WriteProperty(scope, (object)properties, 3096, 1) || Convert.ToInt32(ReadProperty(scope, (object)properties, 3096)) != 1))
            throw new ConnectorException("DRIVER_ERROR"); // WIA_IPS_PAGES: acquire exactly one page.
        var intent = request.Color == "color" ? 1 : request.Color == "gray" ? 2 : 4;
        if (!WriteProperty(scope, (object)properties, 6146, intent) || !WriteProperty(scope, (object)properties, 6147, request.Dpi) || !WriteProperty(scope, (object)properties, 6148, request.Dpi))
            throw new ConnectorException("DRIVER_ERROR");
        if ((Convert.ToInt32(ReadProperty(scope, (object)properties, 6146)) & 7) != intent || Convert.ToInt32(ReadProperty(scope, (object)properties, 6147)) != request.Dpi || Convert.ToInt32(ReadProperty(scope, (object)properties, 6148)) != request.Dpi)
            throw new ConnectorException("DRIVER_ERROR");
        WriteProperty(scope, (object)properties, 6149, 0);
        WriteProperty(scope, (object)properties, 6150, 0);
        // Use A4 when exposed by the driver; otherwise preserve its scan area.
        WriteProperty(scope, (object)properties, 6151, (int)Math.Floor(request.Dpi * 210d / 25.4d));
        WriteProperty(scope, (object)properties, 6152, (int)Math.Floor(request.Dpi * 297d / 25.4d));
        token.ThrowIfCancellationRequested();
        dynamic image = scope.Add(selected.Transfer(BitmapFormat));
        var width = (int)image.Width;
        var height = (int)image.Height;
        if (width < 1 || height < 1 || (long)width * height > MaxPixels) throw new ConnectorException("SCAN_FAILED");
        dynamic fileData = scope.Add(image.FileData);
        byte[] bytes = fileData.BinaryData;
        return NativeImageCodec.Encode(bytes, width, height, token, request.Dpi);
    }

    private static object CreateManager()
    {
        var type = Type.GetTypeFromProgID("WIA.DeviceManager");
        return type is null ? throw new ConnectorException("DRIVER_ERROR") : Activator.CreateInstance(type) ?? throw new ConnectorException("DRIVER_ERROR");
    }

    private static List<object> Items(ComScope scope, dynamic device)
    {
        dynamic children = scope.Add(device.Items);
        var items = new List<object>();
        for (var i = 1; i <= Math.Min((int)children.Count, 32); i++) items.Add(scope.Add(children[i]));
        return items;
    }

    private static string Category(ComScope scope, dynamic item)
    {
        dynamic properties = scope.Add(item.Properties);
        return (Convert.ToString(ReadProperty(scope, (object)properties, 4125)) ?? "").Trim('{', '}').ToUpperInvariant();
    }

    private static List<string> Sources(ComScope scope, dynamic device, List<object> items)
    {
        var sources = new List<string>();
        foreach (dynamic item in items)
        {
            var category = Category(scope, (object)item);
            if (category == FlatbedCategory && !sources.Contains("flatbed")) sources.Add("flatbed");
            if (category == FeederCategory && !sources.Contains("feeder")) sources.Add("feeder");
        }
        dynamic properties = scope.Add(device.Properties);
        var capabilities = ReadProperty(scope, (object)properties, 3086);
        if (capabilities is not null)
        {
            var flags = Convert.ToInt32(capabilities);
            if ((flags & 2) != 0 && !sources.Contains("flatbed")) sources.Add("flatbed");
            if ((flags & 1) != 0 && !sources.Contains("feeder")) sources.Add("feeder");
        }
        if (sources.Count == 0 && items.Count == 1)
        {
            dynamic firstProperties = scope.Add(((dynamic)items[0]).Properties);
            // A flatbed-only WIA 1.0 driver omits document-handling properties.
            if (ReadProperty(scope, (object)firstProperties, 6147) is not null) sources.Add("flatbed");
        }
        return sources;
    }

    private static object? ReadProperty(ComScope scope, dynamic properties, int id)
    {
        for (var i = 1; i <= Math.Min((int)properties.Count, 512); i++)
        {
            dynamic property = scope.Add(properties[i]);
            if ((int)property.PropertyID == id) return property.Value;
        }
        return null;
    }

    private static bool WriteProperty(ComScope scope, dynamic properties, int id, int value)
    {
        for (var i = 1; i <= Math.Min((int)properties.Count, 512); i++)
        {
            dynamic property = scope.Add(properties[i]);
            if ((int)property.PropertyID != id) continue;
            try { property.Value = value; return true; }
            catch (COMException) { return false; }
        }
        return false;
    }

    private static Exception SafeError(Exception error)
    {
        if (error is ConnectorException) return error;
        if (error is OperationCanceledException) return new ConnectorException("CANCELLED");
        var code = unchecked((uint)error.HResult);
        return new ConnectorException(code switch
        {
            0x80210003 => "NO_PAPER",
            0x80210006 => "BUSY",
            0x80210005 or 0x8021000A => "NO_DEVICE",
            0x80210002 or 0x80210004 or 0x80210010 => "SCAN_FAILED",
            0x80210015 => "NO_DEVICE",
            _ => "DRIVER_ERROR"
        });
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0) _work.CompleteAdding();
    }

    private sealed class ComScope : IDisposable
    {
        private readonly List<object> _objects = [];
        private readonly HashSet<object> _seen = new(ReferenceEqualityComparer.Instance);
        public object Add(object value) { if (Marshal.IsComObject(value) && _seen.Add(value)) _objects.Add(value); return value; }
        public void Dispose()
        {
            for (var i = _objects.Count - 1; i >= 0; i--) try { Marshal.FinalReleaseComObject(_objects[i]); } catch { }
            _objects.Clear(); _seen.Clear();
        }
    }
}
