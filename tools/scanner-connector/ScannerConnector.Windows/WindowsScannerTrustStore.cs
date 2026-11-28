using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using Snote.ScannerConnector.Core;

namespace Snote.ScannerConnector.Windows;

// Only approved public browser keys are persisted. Windows DPAPI binds the
// authenticated file to the current Windows user; scan bytes and cloud tokens
// never enter this store.
internal sealed class WindowsScannerTrustStore : IScannerTrustStore
{
    private const int MaximumEntries = 32, MaximumFileBytes = 65_536;
    private static readonly byte[] Entropy = "S-NOTE scanner browser trust v1"u8.ToArray();
    private readonly object _gate = new();
    private readonly string _path;
    private List<ScannerTrustEntry> _entries;

    public WindowsScannerTrustStore(string? path = null)
    {
        _path = path ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Snote", "ScannerConnector", "trusted-browsers.bin");
        _entries = Load();
    }

    public int Count { get { lock (_gate) return _entries.Count; } }

    public bool IsTrusted(ScannerTrustEntry entry)
    {
        if (!Valid(entry)) return false;
        lock (_gate) return _entries.Contains(entry);
    }

    public void Remember(ScannerTrustEntry entry)
    {
        if (!Valid(entry)) throw new InvalidOperationException("INVALID_BROWSER_TRUST");
        lock (_gate)
        {
            var next = _entries.Where(item => !(item.Origin == entry.Origin && item.Scope == entry.Scope && item.ClientId == entry.ClientId)).ToList();
            while (next.Count >= MaximumEntries) next.RemoveAt(0);
            next.Add(entry);
            Save(next);
            _entries = next;
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            _entries = [];
            // Keep this process fail-closed even if durable storage fails. If
            // the atomic write cannot complete, removing the old file is also
            // a complete persistent revocation. A failure of both is surfaced.
            try { Save([]); }
            catch
            {
                File.Delete(_path);
                if (File.Exists(_path)) throw new IOException();
            }
        }
    }

    private List<ScannerTrustEntry> Load()
    {
        byte[]? protectedBytes = null, plain = null;
        try
        {
            if (!File.Exists(_path)) return [];
            var info = new FileInfo(_path);
            if (info.Length is < 1 or > MaximumFileBytes) return [];
            protectedBytes = File.ReadAllBytes(_path);
            if (protectedBytes.Length > MaximumFileBytes) return [];
            plain = Transform(protectedBytes, false);
            if (plain.Length is < 1 or > MaximumFileBytes) return [];
            var file = JsonSerializer.Deserialize<TrustFile>(plain, new JsonSerializerOptions { MaxDepth = 4 });
            if (file?.Version != 1 || file.Entries is null || file.Entries.Count > MaximumEntries ||
                file.Entries.Any(item => !Valid(item)) || file.Entries.Distinct().Count() != file.Entries.Count) return [];
            return file.Entries;
        }
        catch { return []; } // A copied or corrupt file never grants access.
        finally
        {
            if (plain is not null) CryptographicOperations.ZeroMemory(plain);
            if (protectedBytes is not null) CryptographicOperations.ZeroMemory(protectedBytes);
        }
    }

    private void Save(List<ScannerTrustEntry> entries)
    {
        var folder = Path.GetDirectoryName(_path) ?? throw new IOException();
        Directory.CreateDirectory(folder);
        var temporary = Path.Combine(folder, ".browser-trust-" + Guid.NewGuid().ToString("N") + ".tmp");
        var plain = JsonSerializer.SerializeToUtf8Bytes(new TrustFile(1, entries));
        byte[]? protectedBytes = null;
        try
        {
            if (plain.Length > MaximumFileBytes) throw new IOException();
            protectedBytes = Transform(plain, true);
            if (protectedBytes.Length > MaximumFileBytes) throw new IOException();
            using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                file.Write(protectedBytes);
                file.Flush(true);
            }
            if (File.Exists(_path)) File.Replace(temporary, _path, null, true);
            else File.Move(temporary, _path);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
            if (protectedBytes is not null) CryptographicOperations.ZeroMemory(protectedBytes);
            try { File.Delete(temporary); } catch { }
        }
    }

    private static bool Valid(ScannerTrustEntry? entry)
    {
        if (entry is null || entry.Origin is not ("https://s-note.kr" or "https://s-note.pages.dev") ||
            !Hex(entry.ClientId) || !Hex(entry.Scope) || entry.PublicKey is null || entry.PublicKey.Length is < 100 or > 256) return false;
        byte[]? bytes = null;
        try
        {
            bytes = Convert.FromBase64String(entry.PublicKey);
            if (Convert.ToBase64String(bytes) != entry.PublicKey) return false;
            using var key = ECDsa.Create();
            key.ImportSubjectPublicKeyInfo(bytes, out var read);
            return read == bytes.Length && key.KeySize == 256 &&
                key.ExportParameters(false).Curve.Oid.Value == "1.2.840.10045.3.1.7" &&
                Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() == entry.ClientId;
        }
        catch { return false; }
        finally { if (bytes is not null) CryptographicOperations.ZeroMemory(bytes); }
    }

    private static bool Hex(string? value) => value is not null && value.Length == 64 && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private sealed record TrustFile(int Version, List<ScannerTrustEntry> Entries);

    private static byte[] Transform(byte[] bytes, bool protect)
    {
        DataBlob input = new(), entropy = new(), output = new();
        try
        {
            input = Allocate(bytes);
            entropy = Allocate(Entropy);
            var success = protect
                ? CryptProtectData(ref input, null, ref entropy, IntPtr.Zero, IntPtr.Zero, 1, out output)
                : CryptUnprotectData(ref input, IntPtr.Zero, ref entropy, IntPtr.Zero, IntPtr.Zero, 1, out output);
            if (!success || output.Length is < 1 or > MaximumFileBytes || output.Data == IntPtr.Zero) throw new CryptographicException();
            var result = new byte[output.Length];
            Marshal.Copy(output.Data, result, 0, result.Length);
            return result;
        }
        finally
        {
            Release(ref input, false);
            Release(ref entropy, false);
            Release(ref output, true);
        }
    }

    private static DataBlob Allocate(byte[] bytes)
    {
        var pointer = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, pointer, bytes.Length);
        return new() { Length = bytes.Length, Data = pointer };
    }

    private static void Release(ref DataBlob blob, bool local)
    {
        if (blob.Data == IntPtr.Zero) return;
        // Public keys are not secrets, but avoid leaving decrypted records in
        // unmanaged process memory after a trust operation.
        for (var at = 0; at < Math.Clamp(blob.Length, 0, MaximumFileBytes); at++) Marshal.WriteByte(blob.Data, at, 0);
        if (local) LocalFree(blob.Data); else Marshal.FreeHGlobal(blob.Data);
        blob = default;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob { public int Length; public IntPtr Data; }
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(ref DataBlob input, string? description, ref DataBlob entropy, IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);
    [DllImport("crypt32.dll", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(ref DataBlob input, IntPtr description, ref DataBlob entropy, IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);
    [DllImport("kernel32.dll")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern IntPtr LocalFree(IntPtr memory);
}
