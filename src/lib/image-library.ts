import { prisma } from "./prisma";
import { displayImageUrl } from "./image-urls";
import type { ProfileImageStatus } from "../generated/prisma/client";

// One serializer for a profile's image library — the Images page and the
// /api/images GET both use it, so the list shape and ordering can't drift
// between the server-rendered grid and the picker dialog.

export interface ImageListItem {
  id: string;
  source: string;
  status: string;
  url: string;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  category: string | null;
  uploadedBy: string | null;
  timesUsed: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function listProfileImages(
  profileId: string,
  status?: ProfileImageStatus
): Promise<ImageListItem[]> {
  const images = await prisma.profileImage.findMany({
    where: { profileId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      source: true,
      status: true,
      publicToken: true,
      googleUrl: true,
      thumbnailUrl: true,
      width: true,
      height: true,
      byteSize: true,
      category: true,
      uploadedBy: true,
      timesUsed: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return images.map((img) => ({
    id: img.id,
    source: img.source,
    status: img.status,
    url: displayImageUrl(img),
    width: img.width,
    height: img.height,
    byteSize: img.byteSize,
    category: img.category,
    uploadedBy: img.uploadedBy,
    timesUsed: img.timesUsed,
    lastUsedAt: img.lastUsedAt?.toISOString() ?? null,
    createdAt: img.createdAt.toISOString(),
  }));
}
