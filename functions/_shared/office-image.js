// Independent pure decoder boundary for authenticated operational evidence.
// Container checks follow the existing registration parser; no signup state or ACL is imported.
export function inspectOfficeImage(bytes, declared) {
 const MAX_PIXELS=40000000;let size;
 const fail=code=>{throw Object.assign(new Error(code),{code});};
 function dimensions(width,height){if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>16384||height>16384||width*height>MAX_PIXELS)fail('UNSUPPORTED_MEDIA_TYPE');return size={width,height};}
 if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>5242880)fail('PAYLOAD_TOO_LARGE');
const u16be = (b, i) => b[i] * 256 + b[i + 1], u16le = (b, i) => b[i] + b[i + 1] * 256;
const u24le = (b, i) => b[i] + b[i + 1] * 256 + b[i + 2] * 65536;
const u32be = (b, i) => (b[i] * 16777216 + b[i + 1] * 65536 + b[i + 2] * 256 + b[i + 3]) >>> 0;
const u32le = (b, i) => (b[i] + b[i + 1] * 256 + b[i + 2] * 65536 + b[i + 3] * 16777216) >>> 0;
const ascii = (b, i, value) => [...value].every((character, n) => b[i + n] === character.charCodeAt(0));
const CRC = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
function crc(bytes, start, end) { let value = 0xffffffff; for (let index = start; index < end; index++) value = CRC[(value ^ bytes[index]) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; }
function png(bytes) {
  if (bytes.length < 57 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) fail('UNSUPPORTED_MEDIA_TYPE');
  let at = 8, count = 0, hasData = false, dataClosed = false, palette = false, color, dataSize = 0;
  const prefix = [];
  while (at + 12 <= bytes.length && ++count <= 4096) {
    const length = u32be(bytes, at), end = at + 12 + length;
    if (end > bytes.length) fail('UNSUPPORTED_MEDIA_TYPE');
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (!/^[A-Za-z]{4}$/.test(type)) fail('UNSUPPORTED_MEDIA_TYPE');
    if (count === 1) {
      if (type !== 'IHDR' || length !== 13 || crc(bytes, at + 4, at + 8 + length) !== u32be(bytes, at + 8 + length)) fail('UNSUPPORTED_MEDIA_TYPE');
      dimensions(u32be(bytes, at + 8), u32be(bytes, at + 12)); color = bytes[at + 17];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(bytes[at + 16]) || bytes[at + 18] !== 0 || bytes[at + 19] !== 0 || ![0, 1].includes(bytes[at + 20])) fail('UNSUPPORTED_MEDIA_TYPE');
    } else if (type === 'IHDR') fail('UNSUPPORTED_MEDIA_TYPE');
    if (type === 'PLTE') { if (hasData || !length || length > 768 || length % 3) fail('UNSUPPORTED_MEDIA_TYPE'); palette = true; }
    if (type === 'IDAT') {
      if (dataClosed || color === 3 && !palette) fail('UNSUPPORTED_MEDIA_TYPE');
      for (let i = 0; i < length && prefix.length < 2; i++) prefix.push(bytes[at + 8 + i]);
      dataSize += length;
      hasData = true;
    } else if (hasData) dataClosed = true;
    if (type === 'IEND') { if (length || end !== bytes.length || !hasData || dataSize < 6 || (prefix[0] & 15) !== 8 || ((prefix[0] << 8) + prefix[1]) % 31 || prefix[1] & 32 || u32be(bytes, at + 8) !== 0xae426082) fail('UNSUPPORTED_MEDIA_TYPE'); return 'image/png'; }
    if (/^[A-Z]/.test(type) && !['IHDR', 'PLTE', 'IDAT'].includes(type)) fail('UNSUPPORTED_MEDIA_TYPE');
    at = end;
  }
  fail('UNSUPPORTED_MEDIA_TYPE');
}
function jpeg(bytes) {
  if (bytes.length < 24 || bytes[0] !== 255 || bytes[1] !== 216) fail('UNSUPPORTED_MEDIA_TYPE');
  let at = 2, frame = false, scan = false, entropy = false, components = 0;
  while (at < bytes.length) {
    if (entropy) {
      let data = false;
      while (at < bytes.length - 1) {
        if (bytes[at] !== 255) { at++; data = true; continue; }
        let next = at + 1; while (next < bytes.length && bytes[next] === 255) next++;
        if (next >= bytes.length) fail('UNSUPPORTED_MEDIA_TYPE');
        if (bytes[next] === 0 || bytes[next] >= 208 && bytes[next] <= 215) { at = next + 1; data = true; continue; }
        break;
      }
      if (!data) fail('UNSUPPORTED_MEDIA_TYPE'); entropy = false;
    }
    if (bytes[at++] !== 255) fail('UNSUPPORTED_MEDIA_TYPE'); while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 217) { if (!frame || !scan || at !== bytes.length) fail('UNSUPPORTED_MEDIA_TYPE'); return 'image/jpeg'; }
    if ([0, 216, 1].includes(marker) || marker >= 208 && marker <= 215 || at + 2 > bytes.length) fail('UNSUPPORTED_MEDIA_TYPE');
    const length = u16be(bytes, at); if (length < 2 || at + length > bytes.length) fail('UNSUPPORTED_MEDIA_TYPE');
    if ([192, 193, 194].includes(marker)) {
      if (frame || length < 8 || bytes[at + 2] !== 8) fail('UNSUPPORTED_MEDIA_TYPE'); components = bytes[at + 7];
      if (![1, 3, 4].includes(components) || length !== 8 + components * 3) fail('UNSUPPORTED_MEDIA_TYPE');
      dimensions(u16be(bytes, at + 5), u16be(bytes, at + 3)); frame = true;
    } else if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) fail('UNSUPPORTED_MEDIA_TYPE');
    if (marker === 218) { if (!frame || length < 6 || bytes[at + 2] < 1 || bytes[at + 2] > components || length !== 6 + 2 * bytes[at + 2]) fail('UNSUPPORTED_MEDIA_TYPE'); scan = true; entropy = true; }
    at += length;
  }
  fail('UNSUPPORTED_MEDIA_TYPE');
}
function webp(bytes) {
  if (bytes.length < 26 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP') || u32le(bytes, 4) !== bytes.length - 8) fail('UNSUPPORTED_MEDIA_TYPE');
  let at = 12, count = 0, canvas = null, image = null;
  while (at + 8 <= bytes.length && ++count <= 1024) {
    const size = u32le(bytes, at + 4), start = at + 8, end = start + size, next = end + (size & 1), type = String.fromCharCode(...bytes.subarray(at, at + 4));
    if (end > bytes.length || next > bytes.length || size & 1 && bytes[end] !== 0) fail('UNSUPPORTED_MEDIA_TYPE');
    if (type === 'VP8X') {
      if (count !== 1 || size !== 10 || bytes[start] & 0xc3 || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) fail('UNSUPPORTED_MEDIA_TYPE');
      canvas = dimensions(u24le(bytes, start + 4) + 1, u24le(bytes, start + 7) + 1);
    } else if (type === 'VP8 ') {
      if (image || !canvas && count !== 1 || size < 10 || bytes[start] & 1 || ![157, 1, 42].every((value, i) => bytes[start + 3 + i] === value)) fail('UNSUPPORTED_MEDIA_TYPE');
      image = dimensions(u16le(bytes, start + 6) & 16383, u16le(bytes, start + 8) & 16383);
    } else if (type === 'VP8L') {
      if (image || !canvas && count !== 1 || size < 5 || bytes[start] !== 47 || u32le(bytes, start + 1) >>> 29) fail('UNSUPPORTED_MEDIA_TYPE');
      const value = u32le(bytes, start + 1); image = dimensions((value & 16383) + 1, (value >>> 14 & 16383) + 1);
    } else if (type === 'ANIM' || type === 'ANMF' || !canvas && !image) fail('UNSUPPORTED_MEDIA_TYPE');
    at = next;
  }
  if (at !== bytes.length || !image || canvas && (canvas.width !== image.width || canvas.height !== image.height)) fail('UNSUPPORTED_MEDIA_TYPE');
  return 'image/webp';
}
function imageType(bytes, declared) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(declared)) fail('UNSUPPORTED_MEDIA_TYPE');
  const detected = bytes[0] === 137 ? png(bytes) : bytes[0] === 255 ? jpeg(bytes) : ascii(bytes, 0, 'RIFF') ? webp(bytes) : null;
  if (detected !== declared) fail('UNSUPPORTED_MEDIA_TYPE'); return detected;
}
 const mimeType=imageType(bytes,declared);return {mimeType,...size};
}
