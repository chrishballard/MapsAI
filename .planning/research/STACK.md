# Stack Research

**Domain:** GBP management SaaS — Profile Optimization & UI Enhancements (v1.2)
**Researched:** 2026-04-02
**Confidence:** HIGH

---

## Context: What's Already Installed

These are in `package.json`. Do NOT re-add them:

| Already Present | Covers |
|-----------------|--------|
| `chart.js ^4.5.1` + `chartjs-node-canvas ^5.0.0` | Server-side chart rendering for PDF reports — keep for that purpose only |
| `@react-pdf/renderer ^4.3.2` | PDF generation |
| `lucide-react ^0.577.0` | Icons |
| `motion ^12.35.2` | Animations |
| `shadcn ^4.0.0` | Component scaffolding CLI |
| `class-variance-authority`, `clsx`, `tailwind-merge` | Component styling utilities |
| `react 19.2.3`, `react-dom 19.2.3` | Runtime |
| `next 16.1.6` | Framework |

---

## New Dependencies Required

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `recharts` | `^3.8.1` | Line charts, bar charts, radial gauge charts in React UI | shadcn/ui officially uses Recharts as its charting primitive. The shadcn Chart component wraps Recharts via `ChartContainer`/`ChartTooltip` and inherits Tailwind CSS variable theming. Recharts 3.x fully supports React 19 (resolved in 3.x after alpha support in 2.13.0-alpha.2). Built on SVG — scales cleanly at all screen sizes, no canvas blurriness. Composition-first design means you use Recharts components directly without abstraction lock-in. Latest: v3.8.1 (March 2026). |
| `qrcode.react` | `^4.2.0` | Review request QR codes | Zero external dependencies, 1,215 npm dependents (highest adoption in category by 3x). v4 exports `QRCodeSVG` (recommended — scales, integrates with Tailwind-styled containers) and `QRCodeCanvas` (for download-to-PNG via `canvas.toDataURL()`). Pure React component, no server-side setup. Works with `"use client"` in Next.js App Router. |

### Supporting Libraries

No additional libraries required. Details below.

| Need | Solution | Why No New Dep |
|------|----------|----------------|
| Gauge / optimization score display | Recharts `RadialBarChart` with `startAngle={180}` + `endAngle={0}` | Semicircle gauge pattern is fully achievable with Recharts built-ins. See implementation pattern below. |
| Map thumbnails in Business Cards View | Google Maps Static API via `<img>` tag | Plain URL with API key — no npm package. 10,000 free requests/month (within budget for 200 profiles). |
| Line/bar charts (Views on Google, review trends) | Recharts `LineChart`, `BarChart` + shadcn `ChartContainer` | Standard Recharts types. |
| Rating distribution | Recharts `BarChart` (horizontal) | Built-in Recharts — no new dep. |

### Development Tools

No new dev tools required.

---

## Installation

```bash
# New dependencies only (two packages)
npm install recharts qrcode.react
```

**After installing recharts**, update the shadcn Chart component to its Recharts v3-compatible version:

```bash
npx shadcn@latest add chart
```

This pulls the updated chart primitives (PR #8486 merged March 2026) that are compatible with recharts v3 TypeScript types and the updated CSS variable syntax.

---

## Gauge / Score Visualization Pattern

No separate gauge library. Use Recharts `RadialBarChart`:

```tsx
"use client";
import { RadialBarChart, RadialBar, PolarAngleAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";

// startAngle=180, endAngle=0 creates a semicircle pointing down
// PolarAngleAxis domain=[0,100] maps score percentage to arc fill
export function OptimizationGauge({ score }: { score: number }) {
  const color = score >= 70 ? "var(--color-green)" : score >= 40 ? "var(--color-amber)" : "var(--color-red)";
  return (
    <ChartContainer config={{}} className="h-[180px] w-full">
      <RadialBarChart
        data={[{ value: score, fill: color }]}
        innerRadius="70%"
        outerRadius="100%"
        startAngle={180}
        endAngle={0}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
        <RadialBar dataKey="value" cornerRadius={4} background={{ fill: "var(--muted)" }} />
        <text x="50%" y="55%" textAnchor="middle" className="fill-foreground text-4xl font-bold">
          {score}
        </text>
        <text x="50%" y="70%" textAnchor="middle" className="fill-muted-foreground text-sm">
          Optimization Score
        </text>
      </RadialBarChart>
    </ChartContainer>
  );
}
```

## Map Thumbnail Pattern

No npm package. Construct the URL server-side and render as `<img>`:

```tsx
// Generate in a Server Component or server action
function buildStaticMapUrl(address: string): string {
  const encoded = encodeURIComponent(address);
  const key = process.env.GOOGLE_MAPS_STATIC_API_KEY;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${encoded}&zoom=14&size=400x200&markers=color:red%7C${encoded}&key=${key}`;
}

// In Business Card component:
<Image
  src={buildStaticMapUrl(profile.address)}
  alt={`Map of ${profile.name}`}
  width={400}
  height={200}
  className="rounded-md object-cover"
/>
```

Add to `next.config.js`:
```js
images: {
  remotePatterns: [
    {
      protocol: "https",
      hostname: "maps.googleapis.com",
      pathname: "/maps/api/staticmap/**",
    },
  ],
},
```

**Environment variable to add:**
```
GOOGLE_MAPS_STATIC_API_KEY=   # Separate from GBP OAuth creds. Enable Maps Static API in Google Cloud Console.
```

**Pricing:** 10,000 free requests/month under the March 2025 Google Maps per-SKU pricing model. At 200 business cards loaded occasionally, well within free tier.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `recharts ^3.8.1` | `react-chartjs-2` (wrapping the existing chart.js) | If you needed canvas-rendered charts for performance with 100k+ data points — never true here. chart.js stays for server-side PDF workers only. |
| `recharts ^3.8.1` | `nivo` | If you needed highly customized animated charts with a larger ecosystem of types (calendar, sunburst, etc.). Nivo has a larger bundle and no shadcn integration. Not warranted for 4-5 standard chart types. |
| `recharts ^3.8.1` | `victory` | If you needed React Native portability. victory is less actively maintained than recharts and has no shadcn primitives. |
| `qrcode.react ^4.2.0` | `react-qr-code` | Functionally equivalent but 3x fewer npm dependents. No advantage. |
| `qrcode.react ^4.2.0` | `next-qrcode` | Hook-based API, Next.js-specific, adds unnecessary complexity. qrcode.react is simpler. |
| Google Maps Static API URL (no dep) | `@react-google-maps/api` | If you needed interactive maps with panning/zoom. Static thumbnail only — the JS Maps API adds ~100KB runtime for no benefit. |
| Recharts `RadialBarChart` (built-in) | `react-gauge-component` | Only 10 npm dependents (very low adoption). Adds a dependency that Recharts already replaces. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `react-chartjs-2` for UI charts | chart.js/canvas paradigm doesn't compose with shadcn CSS tokens; creates two charting paradigms in one app; chart.js is already present only for server-side PDF generation | `recharts` + shadcn `ChartContainer` |
| `react-gauge-component` | 10 npm dependents — extremely low adoption, adds a dep that Recharts replaces cleanly | Recharts `RadialBarChart` with `startAngle/endAngle` |
| `@react-google-maps/api` or `google-maps-react` | ~100KB JS bundle for a static thumbnail | Google Maps Static API `<img src="...staticmap?...">` |
| `leaflet` / `react-leaflet` | Interactive maps not needed — thumbnail display only | Google Maps Static API URL |
| `next-qrcode` | Next.js-specific, hook-based API adds indirection | `qrcode.react` — simpler, same output |
| Any gauge-specific library | Redundant with Recharts; fragments the chart dependency surface | Recharts `RadialBarChart` |

---

## Stack Patterns by Variant

**If review QR code needs to be downloadable (PNG):**
- Use `QRCodeCanvas` from `qrcode.react` instead of `QRCodeSVG`
- Access via `ref.current.toDataURL()` to create a download link
- Pattern: `<a download="review-qr.png" href={canvasRef.current?.toDataURL()}>Download</a>`

**If map thumbnail fails (API key not configured):**
- Render a placeholder with the business address text instead of the `<Image>` component
- Use a graceful fallback: `onError` on the `<img>` tag sets a fallback state

**If optimization score needs color-coded bands:**
- Pass score to a utility function: `getScoreColor(score)` → returns Tailwind/CSS variable class
- Green: ≥70, Amber: 40-69, Red: <40 — align with GBP audit industry conventions

---

## Version Compatibility

| Package | React Peer Req | Notes |
|---------|---------------|-------|
| `recharts ^3.8.1` | React 18 or 19 | React 19 support was added in 2.13.0-alpha.2, stable in all 3.x releases. Verified compatible with `react@19.2.3`. |
| `qrcode.react ^4.2.0` | React 16.8+ | No peer dep issues with React 19. v4 deprecates `includeMargin` — use `marginSize` prop instead. |
| shadcn chart component (Recharts v3) | — | Requires re-running `npx shadcn@latest add chart` to get v3-compatible component. PR #8486 merged March 2026. Breaking change: use `var(--chart-1)` not `hsl(var(--chart-1))` in CSS. |

---

## Integration Notes

**Recharts + Tailwind CSS 4:** Recharts renders SVG with inline styles. Tailwind CSS 4 utility classes don't apply inside SVG directly. Use shadcn's `ChartContainer` which injects CSS variables (`--chart-1` through `--chart-5`, `--color-{key}`) that Recharts consumes via `fill="var(--color-xxx)"` in chart data objects.

**Recharts in App Router:** All Recharts components require `"use client"` — they use `ResizeObserver` internally. Keep chart components in `/components/charts/` as client components. Server components and server actions fetch data and pass it as props.

**qrcode.react in App Router:** Add `"use client"` to any component rendering `<QRCodeSVG>` or `<QRCodeCanvas>`. For review request QR codes, construct the Google review URL server-side (e.g., in a server action or server component) and pass the URL string as a prop to the client component.

**Google Maps Static API in App Router:** Construct the URL in Server Components to keep the API key server-side. Never expose `GOOGLE_MAPS_STATIC_API_KEY` to the client — always build the URL in server-side code and pass the constructed `src` string to an `<Image>` component.

---

## Sources

- [shadcn/ui Chart docs](https://ui.shadcn.com/docs/components/chart) — Recharts v3 requirement confirmed, migration guide — HIGH confidence
- [shadcn/ui PR #8486](https://github.com/shadcn-ui/ui/pull/8486/files) — Recharts v3 support merged March 2026 — HIGH confidence
- [recharts GitHub releases](https://github.com/recharts/recharts/releases) — v3.8.1 latest as of March 2026 — HIGH confidence
- [recharts React 19 issue #4558](https://github.com/recharts/recharts/issues/4558) — React 19 compatibility confirmed in 3.x — HIGH confidence
- [shadcn/ui recharts v3 compatibility issue #9892](https://github.com/shadcn-ui/ui/issues/9892) — resolved March 2026 — HIGH confidence
- [shadcn/ui radial chart patterns](https://www.shadcn.io/patterns/chart-radial-shape) — RadialBarChart gauge pattern using endAngle — HIGH confidence
- [qrcode.react npm](https://www.npmjs.com/package/qrcode.react) — v4.2.0, 1,215 dependents, SVG+Canvas exports — HIGH confidence
- [Google Maps Static API docs](https://developers.google.com/maps/documentation/maps-static/start) — URL format verified — HIGH confidence
- [Google Maps Static API pricing](https://developers.google.com/maps/documentation/maps-static/usage-and-billing) — 10,000 free/month per March 2025 pricing model — HIGH confidence

---

*Stack research for: Rankmaps.io v1.2 Profile Optimization & UI Enhancements*
*Researched: 2026-04-02*
