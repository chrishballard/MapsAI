# Post Images

Every GBP post can carry a photo. Photos live in a per-profile **image
library** (`ProfileImage`) with three intake paths:

| Source | How it gets in | Initial status |
| --- | --- | --- |
| `GBP` | "Sync from Google" on the Images page (or automatically at post generation when the library is empty, throttled to once per 24h). Metadata only — Google keeps hosting the bytes. | `APPROVED` |
| `TEAM` | "Upload photos" on the Images page. Bytes stored in Postgres. | `APPROVED` |
| `CLIENT` | The public share link (`/u/<uploadToken>`), a no-login page the client opens on their phone. Bytes stored in Postgres. | `PENDING` until a team member approves |

## Rotation

`pickImagesForPosts` assigns one approved image per generated post,
least-recently-used first (never-used photos go out before repeats), and
cycles when a batch is bigger than the pool. An empty library simply means
text-only posts — generation never fails because of images. Attach-time
usage is recorded (`timesUsed`, `lastUsedAt`) so the rotation advances.

Posts can also be hand-assigned a photo in the post detail dialog
("Add photo" / "Change photo"), which only offers `APPROVED` images from the
post's own profile.

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
