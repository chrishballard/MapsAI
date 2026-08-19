import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { profileForUploadToken } from "@/lib/image-upload";
import { isValidImageToken } from "@/lib/image-tokens";
import { PhotoUploader } from "./photo-uploader";

// Secret-link page — keep it out of search indexes.
export const metadata: Metadata = {
  title: "Share photos | Vineyard Growth",
  robots: { index: false, follow: false },
};

interface ClientUploadPageProps {
  params: Promise<{ token: string }>;
}

export default async function ClientUploadPage({
  params,
}: ClientUploadPageProps) {
  const { token } = await params;

  if (!isValidImageToken(token)) notFound();

  const profile = await profileForUploadToken(token);
  if (!profile) notFound();

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-xl mx-auto px-6 py-5 flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
            V
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-900 leading-tight">
              Vineyard Growth
            </p>
            <p className="text-xs text-zinc-500 leading-tight">
              Photo drop-off
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-xl w-full mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">
          Share photos of {profile.name}
        </h1>
        <p className="text-zinc-500 mt-2 text-sm leading-relaxed">
          Send us your best photos: jobs you&apos;re proud of, your team,
          your storefront, before and afters. We&apos;ll use them in your
          Google Business Profile posts to help your business stand out.
        </p>

        <div className="mt-6">
          <PhotoUploader token={token} />
        </div>
      </main>

      <footer className="py-6 text-center text-xs text-zinc-400">
        Uploads go straight to the Vineyard Growth team.
      </footer>
    </div>
  );
}
