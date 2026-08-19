import { prisma } from "./prisma";
import { newImageToken } from "./image-tokens";
import {
  validateImageUpload,
  MAX_IMAGES_PER_PROFILE,
} from "./image-validation";

export interface StoredFileResult {
  fileName: string;
  ok: boolean;
  error?: string;
  imageId?: string;
}

// Grid cells render at ~240px; a 480px JPEG thumb covers retina displays at
// a fraction of the original's weight.
const THUMB_MAX_EDGE = 480;
// Never decode images this large just for a thumbnail (decompression cost).
const THUMB_MAX_SOURCE_PIXELS = 40_000_000;

/**
 * Downscaled JPEG for grid/preview serving, generated once at upload.
 * Returns null when a thumb isn't worth storing (image already small) or
 * can't be produced (decode failure, absurd dimensions) — the serving route
 * falls back to the original bytes.
 */
async function makeThumbnail(
  buf: Uint8Array,
  width: number,
  height: number
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (width * height > THUMB_MAX_SOURCE_PIXELS) return null;
  const scale = THUMB_MAX_EDGE / Math.max(width, height);
  if (scale >= 1) return null;

  try {
    const { createCanvas, loadImage } = await import("canvas");
    const img = await loadImage(Buffer.from(buf));
    const canvas = createCanvas(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale))
    );
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Uint8Array(canvas.toBuffer("image/jpeg", { quality: 0.8 }));
  } catch (err) {
    console.warn("[image-upload] Thumbnail generation failed:", err);
    return null;
  }
}

/**
 * Validate and store a batch of uploaded photos for a profile. Shared by
 * the team upload endpoint and the public client-upload endpoint — the only
 * differences between the two are source/status/uploadedBy.
 *
 * Each file succeeds or fails independently so one bad photo in a batch
 * never blocks the rest; per-file errors go back to the uploader verbatim.
 *
 * The whole batch runs in one transaction holding a per-profile advisory
 * lock, so concurrent uploads (the public link can be opened on several
 * devices) can't race past the MAX_IMAGES_PER_PROFILE cap.
 */
export async function storeUploadedImages(
  profileId: string,
  files: File[],
  opts: {
    source: "TEAM" | "CLIENT";
    status: "APPROVED" | "PENDING";
    uploadedBy?: string | null;
  }
): Promise<StoredFileResult[]> {
  // Validate and thumbnail outside the transaction — CPU work shouldn't
  // hold the lock or the connection.
  type PreparedFile =
    | { fileName: string; ok: false; error: string }
    | {
        fileName: string;
        ok: true;
        buf: Uint8Array<ArrayBuffer>;
        contentType: string;
        width: number;
        height: number;
        thumb: Uint8Array<ArrayBuffer> | null;
      };

  const prepared: PreparedFile[] = await Promise.all(
    files.map(async (file): Promise<PreparedFile> => {
      const buf = new Uint8Array(await file.arrayBuffer());
      const validated = validateImageUpload(buf);
      if (!validated.ok) {
        return { fileName: file.name, ok: false, error: validated.error };
      }
      return {
        fileName: file.name,
        ok: true,
        buf,
        contentType: validated.contentType,
        width: validated.width,
        height: validated.height,
        thumb: await makeThumbnail(buf, validated.width, validated.height),
      };
    })
  );

  return prisma.$transaction(
    async (tx) => {
      // Serialize per-profile so two concurrent batches both see an
      // up-to-date count (the lock releases with the transaction).
      // $executeRaw, not $queryRaw: the lock function returns void, which
      // Prisma cannot deserialize as a result column.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${profileId}))`;

      let count = await tx.profileImage.count({ where: { profileId } });
      const results: StoredFileResult[] = [];

      for (const item of prepared) {
        if (!item.ok) {
          results.push({ fileName: item.fileName, ok: false, error: item.error });
          continue;
        }

        if (count >= MAX_IMAGES_PER_PROFILE) {
          results.push({
            fileName: item.fileName,
            ok: false,
            error: `Image library is full (${MAX_IMAGES_PER_PROFILE} max). Remove some photos first.`,
          });
          continue;
        }

        const image = await tx.profileImage.create({
          data: {
            profileId,
            source: opts.source,
            status: opts.status,
            publicToken: newImageToken(),
            data: item.buf,
            thumbData: item.thumb,
            contentType: item.contentType,
            byteSize: item.buf.byteLength,
            width: item.width,
            height: item.height,
            uploadedBy: opts.uploadedBy ?? null,
          },
          select: { id: true },
        });

        count++;
        results.push({ fileName: item.fileName, ok: true, imageId: image.id });
      }

      return results;
    },
    // Up to 20 multi-hundred-KB inserts in one transaction — allow headroom
    // beyond the 5s default before the client aborts it.
    { timeout: 30_000 }
  );
}

/** Pull the uploaded File objects out of a multipart form body. */
export function filesFromForm(form: FormData): File[] {
  return form
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File);
}

/**
 * Resolve an upload-link token to its profile. Shared by the /u/[token]
 * page and the public upload API so the two surfaces can never disagree on
 * when a link is live (unknown token or disconnected profile → null).
 */
export async function profileForUploadToken(
  token: string
): Promise<{ id: string; name: string } | null> {
  const profile = await prisma.profile.findUnique({
    where: { uploadToken: token },
    select: { id: true, name: true, isConnected: true },
  });
  if (!profile || !profile.isConnected) return null;
  return { id: profile.id, name: profile.name };
}
