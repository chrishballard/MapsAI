// Minimal-but-valid image byte fixtures. Only the headers matter — the
// validation code parses dimensions from headers without decoding pixels,
// so the rest of the buffer is zero padding to satisfy the size floor.

export function pngBytes(
  width: number,
  height: number,
  totalSize = 12 * 1024
): Uint8Array {
  const buf = new Uint8Array(totalSize);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(buf.buffer);
  view.setUint32(8, 13); // IHDR chunk length
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return buf;
}

export function jpegBytes(
  width: number,
  height: number,
  totalSize = 12 * 1024
): Uint8Array {
  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let o = 0;
  buf.set([0xff, 0xd8], o); // SOI
  o += 2;
  buf.set([0xff, 0xe0], o); // APP0
  view.setUint16(o + 2, 16); // segment length
  o += 2 + 16;
  buf.set([0xff, 0xc0], o); // SOF0
  view.setUint16(o + 2, 17);
  buf[o + 4] = 8; // bit depth
  view.setUint16(o + 5, height);
  view.setUint16(o + 7, width);
  return buf;
}

export function junkBytes(totalSize = 12 * 1024): Uint8Array {
  return new Uint8Array(totalSize).fill(0x41);
}
