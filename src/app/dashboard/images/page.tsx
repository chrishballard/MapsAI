import { Image as ImageIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSelectedProfileId } from "@/lib/selected-profile";
import { appBaseUrl } from "@/lib/image-urls";
import { listProfileImages } from "@/lib/image-library";
import { Card } from "@/components/ui/card";
import { MotionDiv } from "@/components/motion-wrapper";
import { ImageLibrary } from "./image-library";

interface ImagesPageProps {
  searchParams: Promise<{ profileId?: string }>;
}

export default async function ImagesPage({ searchParams }: ImagesPageProps) {
  const params = await searchParams;
  const selectedProfileId = await getSelectedProfileId();
  const profileId = params.profileId || selectedProfileId;

  const profile = profileId
    ? await prisma.profile.findUnique({
        where: { id: profileId },
        select: {
          id: true,
          name: true,
          uploadToken: true,
          mediaSyncedAt: true,
          accountResourceName: true,
        },
      })
    : null;

  if (!profile) {
    return (
      <MotionDiv
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-8"
      >
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
            Images
          </h1>
          <p className="text-zinc-500 mt-1">
            Photo library used for Google Business Profile posts.
          </p>
        </div>
        <Card className="flex flex-col items-center text-center py-16">
          <div className="w-16 h-16 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-400 mb-4">
            <ImageIcon size={32} />
          </div>
          <h2 className="text-lg font-semibold text-zinc-900 mb-2">
            Select a business
          </h2>
          <p className="text-zinc-500 max-w-md">
            Pick a business from the selector above to manage its photo
            library.
          </p>
        </Card>
      </MotionDiv>
    );
  }

  const libraryImages = await listProfileImages(profile.id);

  const base = appBaseUrl();
  const uploadLinkUrl = profile.uploadToken
    ? `${base ?? ""}/u/${profile.uploadToken}`
    : null;

  return (
    <MotionDiv
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      <div>
        <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
          Images
        </h1>
        <p className="text-zinc-500 mt-1">
          Photos attached to {profile.name}&apos;s Google Business Profile
          posts — synced from Google, uploaded by the team, or sent in by the
          client.
        </p>
      </div>

      <ImageLibrary
        profileId={profile.id}
        profileName={profile.name}
        canSyncFromGoogle={Boolean(profile.accountResourceName)}
        lastSyncedAt={profile.mediaSyncedAt?.toISOString() ?? null}
        initialUploadLinkUrl={uploadLinkUrl}
        images={libraryImages}
      />
    </MotionDiv>
  );
}
