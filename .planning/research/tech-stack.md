# Tech Stack Research — MapsAI

## Recommendation Summary

| Layer | Choice | Why |
|-------|--------|-----|
| Backend | Next.js 14+ (App Router) | Full-stack, API routes, SSR dashboard, great DX |
| Database | PostgreSQL (via Prisma) | Relational data, scheduling, robust querying |
| Queue/Scheduling | BullMQ + Redis | Reliable job queues, cron scheduling, retries |
| AI | Claude API (Anthropic SDK) | Post generation, review responses |
| PDF | @react-pdf/renderer or puppeteer | Professional PDF reports |
| Auth | NextAuth.js | Simple internal auth, expandable for paywall later |
| Hosting | Railway or Render | Background workers, cron, PostgreSQL included |
| Frontend | React (via Next.js) + Tailwind CSS | Fast dashboard development |

## Detailed Reasoning

### Backend: Next.js (App Router)
- Single codebase for frontend + API
- Server actions for form handling
- API routes for webhook endpoints and cron triggers
- Google's Node.js client libraries are mature (`googleapis` package)
- TypeScript for type safety across the stack

### Database: PostgreSQL + Prisma
- Scheduling requires reliable datetime queries (when to publish posts)
- Multi-profile management = relational data (profiles, posts, reviews, analytics)
- Prisma gives type-safe queries, migrations, and schema management
- Easy to host on Railway/Render

### Queue: BullMQ + Redis
- Post publishing needs reliable scheduling (not just cron)
- Review response automation needs retry logic
- BullMQ supports: delayed jobs, repeatable jobs, rate limiting, retries
- Redis is lightweight and cheap to host

### AI: Claude API
- Already in Vineyard Growth's ecosystem
- Excellent at generating natural-sounding business posts
- Good at contextual review responses (can consider review sentiment, business info)
- `@anthropic-ai/sdk` for Node.js

### PDF Reports: Puppeteer or @react-pdf/renderer
- Puppeteer: render HTML template to PDF (more design flexibility)
- @react-pdf/renderer: programmatic PDF creation (lighter, no browser dependency)
- Recommendation: start with @react-pdf/renderer, switch to Puppeteer if design needs are complex

### Hosting: Railway
- Native PostgreSQL and Redis support
- Background worker processes (for BullMQ)
- Cron jobs built-in
- Simple deploy from GitHub
- Scales easily when adding paywall later
- ~$20-50/month for this workload

### Auth: NextAuth.js
- Simple credential-based auth for internal team
- Can add OAuth providers later for client-facing version
- Session management built-in
