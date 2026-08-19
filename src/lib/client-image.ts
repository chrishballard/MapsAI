// Browser-side photo preparation, shared by the dashboard uploader and the
// public client upload page. Phones hand us 12-48MP HEIC/WebP originals;
// re-encoding in the browser turns anything the browser can decode into a
// modest JPEG the server accepts (server-side we only take JPEG/PNG). If
// decoding fails the original file is sent as-is and the server's
// validation produces the user-facing error.

const MAX_EDGE = 1600;
const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
const JPEG_QUALITY = 0.85;
// Files already in an accepted format below this size skip re-encoding.
const PASSTHROUGH_MAX_BYTES = 3 * 1024 * 1024;

async function decodeToBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // from-image applies EXIF rotation so portrait phone photos stay upright.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Older Safari: retry without options, then fall back to <img> decoding
    // (which applies EXIF orientation natively in all modern browsers).
    try {
      return await createImageBitmap(file);
    } catch {
      const url = URL.createObjectURL(file);
      try {
        const img = document.createElement("img");
        img.src = url;
        await img.decode();
        return img;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }
}

export async function prepareImageForUpload(
  file: File
): Promise<{ blob: Blob; fileName: string }> {
  const isAccepted = file.type === "image/jpeg" || file.type === "image/png";

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decodeToBitmap(file);
  } catch {
    // Undecodable here — let the server produce the real error message.
    return { blob: file, fileName: file.name };
  }

  const width =
    "naturalWidth" in source ? source.naturalWidth : source.width;
  const height =
    "naturalHeight" in source ? source.naturalHeight : source.height;

  let scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  // Never downscale below Google's minimum post-photo size (extreme
  // panoramas would otherwise shrink past it).
  if (width * scale < MIN_WIDTH) scale = Math.min(1, MIN_WIDTH / width);
  if (height * scale < MIN_HEIGHT) {
    scale = Math.max(scale, Math.min(1, MIN_HEIGHT / height));
  }

  if (scale === 1 && isAccepted && file.size <= PASSTHROUGH_MAX_BYTES) {
    return { blob: file, fileName: file.name };
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { blob: file, fileName: file.name };
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) return { blob: file, fileName: file.name };

  const fileName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return { blob, fileName };
}
