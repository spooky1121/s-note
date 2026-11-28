using System.Drawing.Imaging;
using System.Security.Cryptography;
using Snote.ScannerConnector.Core;

namespace Snote.ScannerConnector.Windows;

internal static class NativeSelfTest
{
    // CI-only entry point. It uses generated pixels/keys and temporary trust
    // files only: no WIA device, window, registry entry, listener or user files.
    public static int Run()
    {
        var stage = "image codec";
        try
        {
            using var bitmap = new Bitmap(160, 120);
            using (var g = Graphics.FromImage(bitmap))
            {
                g.Clear(Color.White);
                using var pen = new Pen(Color.FromArgb(0, 168, 233), 3);
                g.DrawRectangle(pen, 12, 12, 134, 94);
                g.DrawLine(pen, 20, 40, 138, 40);
                g.DrawLine(pen, 20, 70, 138, 70);
            }
            using var source = new MemoryStream();
            bitmap.Save(source, ImageFormat.Png);
            var bytes = source.ToArray();
            var image = NativeImageCodec.Encode(bytes, 160, 120, CancellationToken.None);
            Require(image.Width == 160 && image.Height == 120 && image.MimeType == "image/jpeg" && image.Data.Length is > 3 and <= NativeImageCodec.MaxBytes);
            Require(image.Data[0] == 0xff && image.Data[1] == 0xd8 && bytes.All(value => value == 0));
            using (var encoded = new MemoryStream(image.Data, false))
            using (var decoded = Image.FromStream(encoded)) Require(decoded.Width == 160 && decoded.Height == 120 && Math.Abs(decoded.HorizontalResolution - 300) < 1 && Math.Abs(decoded.VerticalResolution - 300) < 1);
            CryptographicOperations.ZeroMemory(image.Data);
            foreach (var dpi in new[] { 150, 200, 300 })
            {
                var dpiImage = NativeImageCodec.Encode(source.ToArray(), 160, 120, CancellationToken.None, dpi);
                using var dpiStream = new MemoryStream(dpiImage.Data, false);
                using var dpiDecoded = Image.FromStream(dpiStream);
                Require(dpiDecoded.Width == 160 && dpiDecoded.Height == 120 && Math.Abs(dpiDecoded.HorizontalResolution - dpi) < 1 && Math.Abs(dpiDecoded.VerticalResolution - dpi) < 1);
                CryptographicOperations.ZeroMemory(dpiImage.Data);
            }
            foreach (var format in new[] { PixelFormat.Format1bppIndexed, PixelFormat.Format8bppIndexed })
            {
                using var indexed = new Bitmap(160, 120, format);
                using var indexedSource = new MemoryStream();
                indexed.Save(indexedSource, ImageFormat.Bmp);
                var indexedBytes = indexedSource.ToArray();
                var indexedImage = NativeImageCodec.Encode(indexedBytes, 160, 120, CancellationToken.None);
                Require(indexedImage.Data[0] == 0xff && indexedImage.Data[1] == 0xd8 && indexedBytes.All(value => value == 0));
                CryptographicOperations.ZeroMemory(indexedImage.Data);
            }
            var failed = false;
            var mismatch = source.ToArray();
            try { NativeImageCodec.Encode(mismatch, 161, 120, CancellationToken.None); } catch (ConnectorException) { failed = true; }
            Require(failed && mismatch.All(value => value == 0));
            failed = false;
            var oversized = source.ToArray();
            try { NativeImageCodec.Encode(oversized, 40_000_001, 1, CancellationToken.None); } catch (ConnectorException) { failed = true; }
            Require(failed && oversized.All(value => value == 0));
            failed = false;
            var cancelled = source.ToArray();
            try { NativeImageCodec.Encode(cancelled, 160, 120, new CancellationToken(true)); } catch (OperationCanceledException) { failed = true; }
            Require(failed && cancelled.All(value => value == 0));
            using var bounded = new NativeImageCodec.BoundedImageStream(4);
            bounded.Write(new byte[] { 1, 2, 3, 4 });
            try { bounded.WriteByte(5); } catch (IOException) { }
            Require(bounded.LimitReached && bounded.Length == 4);
            foreach (var notice in new[] { "LICENSE.txt", "ThirdPartyNotices.txt" })
            {
                using var resource = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream("Snote.ScannerConnector.Windows.Licenses." + notice);
                Require(resource is not null && resource.Length > 100);
            }
            stage = "browser trust";
            TrustStoreRoundTrip();
            Console.WriteLine("PASS native JPEG encode, byte/pixel bounds, metadata mismatch, cancellation and input cleanup; no device or user data accessed");
            Console.WriteLine("PASS Windows DPAPI browser trust persistence, corruption rejection, scope isolation, entry bound and persistent reset");
            return 0;
        }
        catch
        {
            Console.Error.WriteLine("FAIL native " + stage + " self-test");
            return 1;
        }
    }

    private static void Require(bool value) { if (!value) throw new InvalidOperationException("SELF_TEST_FAILED"); }

    private static void TrustStoreRoundTrip()
    {
        var folder = Path.Combine(Path.GetTempPath(), "snote-scanner-selftest-" + Guid.NewGuid().ToString("N"));
        var file = Path.Combine(folder, "trusted.bin");
        try
        {
            using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            var publicBytes = key.ExportSubjectPublicKeyInfo();
            var entry = new ScannerTrustEntry("https://s-note.kr", Convert.ToHexString(SHA256.HashData(publicBytes)).ToLowerInvariant(),
                new string('a', 64), Convert.ToBase64String(publicBytes));
            var first = new WindowsScannerTrustStore(file);
            Require(first.Count == 0 && !first.IsTrusted(entry));
            first.Remember(entry);
            Require(first.Count == 1 && new WindowsScannerTrustStore(file).IsTrusted(entry));
            Require(!first.IsTrusted(entry with { Origin = "https://s-note.pages.dev" }));
            Require(!first.IsTrusted(entry with { Scope = new string('b', 64) }));
            Require(!first.IsTrusted(entry with { ClientId = new string('c', 64) }));
            var encrypted = File.ReadAllBytes(file);
            Require(!System.Text.Encoding.UTF8.GetString(encrypted).Contains(entry.PublicKey, StringComparison.Ordinal));
            encrypted[encrypted.Length / 2] ^= 0x80;
            File.WriteAllBytes(file, encrypted);
            Require(new WindowsScannerTrustStore(file).Count == 0);
            File.Delete(file);
            Directory.CreateDirectory(file);
            var resetFailed = false;
            try { first.Clear(); } catch { resetFailed = true; }
            Require(resetFailed && first.Count == 0 && !first.IsTrusted(entry));
            Directory.Delete(file);
            var bounded = new WindowsScannerTrustStore(file);
            for (var at = 1; at <= 33; at++) bounded.Remember(entry with { Scope = at.ToString("x64") });
            Require(bounded.Count == 32 && !bounded.IsTrusted(entry with { Scope = 1.ToString("x64") }));
            Require(new WindowsScannerTrustStore(file).Count == 32);
            bounded.Clear();
            Require(bounded.Count == 0 && new WindowsScannerTrustStore(file).Count == 0);
            Require(!Directory.EnumerateFiles(folder, "*.tmp").Any());
        }
        finally { try { Directory.Delete(folder, true); } catch { } }
    }
}
