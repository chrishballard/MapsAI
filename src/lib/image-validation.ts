// Validation for photos entering the image library (team + client uploads).
// Limits mirror Google's requirements for local post photos: JPEG or PNG,
// at least 400x300 pixels and 10KB — anything smaller gets rejected by
// Google at publish time, so reject it at upload time with a clear message.

export const IMAGE_MIN_WIDTH = 400;
export const IMAGE_MIN_HEIGHT = 300;
export const IMAGE_MIN_BYTES = 10 * 1024;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Hard cap on stored images per profile — keeps the public upload link
 * from becoming an unbounded write path into the database. */
export const MAX_IMAGES_PER_PROFILE = 500;
export const MAX_FILES_PER_UPLOAD = 20;

export type ValidatedImage = {
  ok: true;
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
};

export type InvalidImage = { ok: false; error: string };

export function sniffImageContentType(
  buf: Uint8Array
): "image/jpeg" | "image/png" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

/** PNG dimensions live at a fixed offset in the IHDR chunk. */
function pngDimensions(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * JPEG dimensions come from the first SOF (start-of-frame) marker. Walking
 * the marker headers reads a few hundred bytes at most — no full decode, so
 * a maliciously large image can't cost us decode memory.
 */
function jpegDimensions(buf: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 2; // skip FF D8
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    // Standalone markers without a length segment
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    const segmentLength = view.getUint16(offset + 2);
    const isSOF =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG extension
      marker !== 0xcc; // DAC
    if (isSOF) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

export function imageDimensions(
  buf: Uint8Array,
  contentType: "image/jpeg" | "image/png"
): { width: number; height: number } | null {
  return contentType === "image/png" ? pngDimensions(buf) : jpegDimensions(buf);
}

/**
 * Validate an uploaded file's bytes: real JPEG/PNG, within size limits, and
 * large enough for Google to accept as post media.
 */
export function validateImageUpload(
  buf: Uint8Array
): ValidatedImage | InvalidImage {
  if (buf.byteLength > IMAGE_MAX_BYTES) {
    return {
      ok: false,
      error: `Image is too large (max ${IMAGE_MAX_BYTES / (1024 * 1024)}MB)`,
    };
  }

  const contentType = sniffImageContentType(buf);
  if (!contentType) {
    return { ok: false, error: "Only JPG and PNG photos are supported" };
  }

  if (buf.byteLength < IMAGE_MIN_BYTES) {
    return { ok: false, error: "Image is too small (minimum 10KB)" };
  }

  const dims = imageDimensions(buf, contentType);
  if (!dims || dims.width <= 0 || dims.height <= 0) {
    return { ok: false, error: "Could not read the image. The file may be corrupted." };
  }

  if (dims.width < IMAGE_MIN_WIDTH || dims.height < IMAGE_MIN_HEIGHT) {
    return {
      ok: false,
      error: `Image is too small (${dims.width}x${dims.height}). Google requires at least ${IMAGE_MIN_WIDTH}x${IMAGE_MIN_HEIGHT} pixels.`,
    };
  }

  return { ok: true, contentType, width: dims.width, height: dims.height };
}
