# Post Images

Every GBP post can carry a photo. Photos live in a per-profile **image
library** (`ProfileImage`) with three intake paths:

| Source | How it gets in | Initial status |
| --- | --- | --- |
| `GBP` | "Sync from Google" on the Images page (or automatically at post generation when the library is empty, throttled to once per 24h). Metadata only — Google keeps hosting the bytes. | `APPROVED` |
| `TEAM` | "Upload photos" on the Images page. Bytes stored in Postgres. | `APPROVED` |
| `CLIENT` | The public share link (`/u/<uploadToken>`), a no-login page the client opens on their phone. Bytes stored in Postgres. | `PENDING` until a team member approves |

## AI captions

Every library image gets a one-time Claude vision caption stored on the row
(`aiDescription`, `aiTags`, `aiGeneric`, `captionedAt`), so selection can
match photos to post subjects. `aiGeneric: true` means the photo could
accompany any post by this business (storefront, team, logo, equipment,
generic work); `false` means a subject-specific photo (a particular room,
dish, project type) that may only ride posts it fits.

**Invariant: anything `APPROVED` with `captionedAt: null` gets enqueued** on
the `image-caption` queue (worker: `workers/image-caption-worker.ts`, jobs
idempotent per image). Hooks — all failure-swallowed, never blocking their
caller:

- GBP media sync, after its reconcile transaction (covers the Images-page
  button and the empty-library auto-sync; also re-captions photos deleted
  from GBP that reappear as new rows).
- Team upload (`POST /api/images`).
- Client-upload approval, single and bulk (client uploads are NOT captioned
  while `PENDING` — no spend on photos that get rejected).
- Onboarding pre-pass: before the very first post batch, the initial sync
  pulls GBP photos in and captions up to 50 inline so day-one posts match.

Caption inputs: the ~480px thumbnail (uploads) or a server-side fetch of
`googleUrl` (GBP rows). Images with no usable input are skipped permanently
and stay uncaptioned — they're treated as "unknown" and never blind-attached
once the profile has captions.

`scripts/backfill-image-captions.ts` captions existing libraries
(`--dry-run` is fully inert: no writes, no Claude calls — prints counts and
estimated spend).

## Selection

`pickImagesForPostContents` picks one image (or none) per generated post so
text and photo never clash. Claude sees the post texts plus the ≤40
least-recently-used **specific** photos (id + caption) and answers, per
post: a specific image id, `GENERIC`, or `NONE`. Generic photos are never
sent — they're interchangeable, so their rotation stays mechanical LRU in
code (that's the fairness guarantee); ids are validated against the pool and
a specific image is used at most once per batch.

Fallback ladder — an image problem must never fail post generation:

1. Empty library (after the throttled GBP auto-sync) → text-only posts.
2. Zero captioned images → the legacy blind LRU rotation
   (`pickImagesForPosts`, exactly the pre-caption behavior).
3. Captioned but all generic → mechanical generic LRU, no Claude call.
4. Matcher call fails → generics-only rotation; no generics → text-only.
   Once captions exist, an uncaptioned or specific photo is never attached
   blind — a wrong photo is worse than no photo.

Attach-time usage is recorded (`timesUsed`, `lastUsedAt`) so the rotation
advances. Posts can also be hand-assigned a photo in the post detail dialog
("Add photo" / "Change photo"), which only offers `APPROVED` images from the
post's own profile.

`scripts/rematch-post-images.ts` re-runs coherence over already-created
unpublished posts (the original blind backfill's assignments included):
KEEP is the default — only pairings that would look nonsensical are
rewritten, which also protects manual picks. Writes atomically re-check the
post is still unpublished/not-due and still carries the exact photo that
was judged. Its `--dry-run` writes nothing to the DB but DOES call (and
bill) the Claude matcher. Run the caption backfill first. This supersedes
`scripts/backfill-post-images.ts` (the original blind assigner, kept for
reference).

## Publishing

The publish worker resolves the attached image to a `sourceUrl` Google can
fetch (one GBP write per job — the queue limiter is sized for that):

- GBP-synced images use their `googleUrl` (Google's own CDN).
- Uploaded images use `NEXTAUTH_URL` + `/api/public/images/<publicToken>` —
  an unauthenticated route that serves the stored bytes. On a localhost or
  non-https base URL the image is skipped (Google couldn't fetch it) and the
  post goes out text-only, with the reason noted on the post.
- An image hidden after the post was scheduled is skipped, also with a note.

When Google rejects the request while a photo is attached (HTTP 400), the
worker **detaches** the image, records `Image skipped: <reason>` in
`errorMessage`, and rethrows — the normal BullMQ retry then publishes
text-only through the same claim/dedupe/limiter machinery. Non-400 errors
(429/5xx/network) retry unchanged, photo included. `Post.mediaUrl` is a
publish-time record of what actually went out, never an input.

## Upload constraints

JPEG/PNG only, 10KB-10MB, at least 400x300 px (Google's minimum for post
photos) — validated server-side by header parsing (`image-validation.ts`),
no full decode. A ~480px JPEG thumbnail is generated at upload (node-canvas)
and served via `?size=thumb` so grids never stream originals. Both upload
UIs first downscale/re-encode in the browser (`client-image.ts`, longest
edge 1600px, JPEG 0.85), which also converts HEIC/WebP phone photos into
JPEG. Library caps: 500 images per profile (enforced under a per-profile
advisory lock so concurrent uploads can't race past it), 20 files per
request (the team uploader chunks larger selections; the client page
uploads per-file). Pending client uploads are approved one by one or with
a single bulk `PATCH /api/images`.

## Share links

`Profile.uploadToken` (32 hex chars) backs `/u/<token>`. Create, rotate, or
disable it from the Images page — rotating/disabling kills the old link
immediately. The page is `noindex` and only reveals the business name.
