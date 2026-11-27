using System.Drawing.Imaging;
using System.Security.Cryptography;
using Snote.ScannerConnector.Core;

namespace Snote.ScannerConnector.Windows;

internal static class NativeSelfTest
{
    // CI-only entry point. It never creates a WIA device, a window, registry
    // entry or HTTP listener, and it never scans or uploads a document.
    public static int Run()
    {
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
            Console.WriteLine("PASS native JPEG encode, byte/pixel bounds, metadata mismatch, cancellation and input cleanup; no device or user data accessed");
            return 0;
        }
        catch
        {
            Console.Error.WriteLine("FAIL native image codec self-test");
            return 1;
        }
    }

    private static void Require(bool value) { if (!value) throw new InvalidOperationException("SELF_TEST_FAILED"); }
}
