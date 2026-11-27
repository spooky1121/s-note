using System.Drawing.Imaging;
using System.Security.Cryptography;
using Snote.ScannerConnector.Core;

namespace Snote.ScannerConnector.Windows;

internal static class NativeImageCodec
{
    internal const int MaxPixels = 40_000_000, MaxBytes = 5 * 1024 * 1024;

    // Owns the input byte array, including every failure/cancellation path.
    internal static ScanImage Encode(byte[] bytes, int width, int height, CancellationToken token, int dpi = 300)
    {
        try
        {
            token.ThrowIfCancellationRequested();
            if (dpi is not (150 or 200 or 300)) throw new ConnectorException("INVALID_REQUEST");
            if (bytes.Length is < 1 or > 128 * 1024 * 1024 || width < 1 || height < 1 || (long)width * height > MaxPixels)
                throw new ConnectorException("SCAN_FAILED");
            using var stream = new MemoryStream(bytes, false);
            using var decoded = Image.FromStream(stream, false, true);
            if (decoded is not Bitmap bitmap || bitmap.Width != width || bitmap.Height != height || (long)bitmap.Width * bitmap.Height > MaxPixels)
                throw new ConnectorException("SCAN_FAILED");
            // Preserve the requested physical document scale in the JPEG's
            // resolution metadata instead of falling back to encoder defaults.
            bitmap.SetResolution(dpi, dpi);
            var encoder = ImageCodecInfo.GetImageEncoders().Single(e => e.FormatID == ImageFormat.Jpeg.Guid);
            foreach (var quality in new long[] { 90, 80, 70 })
            {
                token.ThrowIfCancellationRequested();
                using var output = new BoundedImageStream(MaxBytes);
                using var settings = new EncoderParameters(1);
                settings.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
                try
                {
                    bitmap.Save(output, encoder, settings);
                    if (!output.LimitReached && output.Length is > 0 and <= MaxBytes)
                        return new ScanImage(output.ToArray(), width, height, "image/jpeg");
                }
                catch (Exception) when (output.LimitReached) { /* Try the next bounded JPEG quality. */ }
                finally { CryptographicOperations.ZeroMemory(output.GetBuffer()); }
            }
            throw new ConnectorException("SCAN_FAILED");
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    internal sealed class BoundedImageStream(int limit) : MemoryStream
    {
        public bool LimitReached { get; private set; }
        private void Bound(long position)
        {
            if (position < 0 || position > limit) { LimitReached = true; throw new IOException("IMAGE_LIMIT"); }
        }
        public override void Write(byte[] buffer, int offset, int count) { Bound(Position + count); base.Write(buffer, offset, count); }
        public override void Write(ReadOnlySpan<byte> buffer) { Bound(Position + buffer.Length); base.Write(buffer); }
        public override void WriteByte(byte value) { Bound(Position + 1); base.WriteByte(value); }
        public override void SetLength(long value) { Bound(value); base.SetLength(value); }
        public override long Position { get => base.Position; set { Bound(value); base.Position = value; } }
        public override long Seek(long offset, SeekOrigin loc)
        {
            var target = loc switch { SeekOrigin.Begin => offset, SeekOrigin.Current => Position + offset, SeekOrigin.End => Length + offset, _ => -1 };
            Bound(target); return base.Seek(offset, loc);
        }
    }
}
