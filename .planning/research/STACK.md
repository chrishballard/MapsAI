# Technology Stack

**Project:** MapsAI
**Researched:** 2026-03-04

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Next.js | 14+ (App Router) | Full-stack framework | Single codebase for API routes + React frontend. Server Actions for form handling. API routes for webhooks/external calls. Google API client libraries work natively in Node.js. |
| TypeScript | 5.x | Type safety | Non-negotiable for a project managing external API data with complex shapes |

**Why Next.js over alternatives:**
- **vs Express:** Express requires separate frontend setup. Next.js gives you API routes + React in one project. For an internal dashboard tool, this is the right tradeoff.
- **vs FastAPI (Python):** Python has equivalent Google API support, but you'd need a separate frontend framework. The AI integration (Claude SDK) works equally well in both. Staying in one language wins.
- **vs Remix/SvelteKit:** Next.js has the largest ecosystem and most examples for Google API integration. Not worth the risk of a smaller community for marginal DX gains.

### Database

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| PostgreSQL | 15+ | Primary database | Relational data (profiles, posts, reviews, users) with strong JSON support for API response caching. Scheduling/queue metadata fits relational model perfectly. |
| Prisma | 5.x | ORM | Type-safe database access, excellent migration system, good Next.js integration |
| Redis | 7.x | Queue backend + caching | Required by BullMQ for job queues. Also useful for caching GBP API responses to avoid rate limits. |

**Why PostgreSQL over alternatives:**
- **vs SQLite:** SQLite cannot handle concurrent writes from web server + background worker processes. With BullMQ running alongside the web app, you need a real database server.
- **vs MongoDB:** The data is inherently relational (profiles have posts, posts have approvals, profiles have reviews). MongoDB would require manual join logic. PostgreSQL's JSONB columns handle any semi-structured API data.

### AI Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @anthropic-ai/sdk | latest | Claude API access | Official TypeScript SDK. Use Claude Sonnet for cost-effective post generation and review responses. |

**Usage pattern:** Claude Sonnet (not Opus) for all text generation. Posts and review responses are short-form content where Sonnet excels. Estimated cost: negligible at 100-200 profiles generating a few posts/week each.

**Prompt architecture:**
- System prompts per use case (post generation, review response)
- Include business context (category, location, tone preferences) in each call
- Store generated content as drafts with `status: 'pending_approval'`

### PDF Generation

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Puppeteer | latest | HTML-to-PDF conversion | Render React components or HTML templates to PDF. Professional quality output with charts, tables, branding. Most flexible approach. |

**Why Puppeteer over alternatives:**
- **vs jsPDF:** jsPDF requires manual coordinate-based layout. Painful for complex reports with charts and tables.
- **vs PDFKit:** Same problem as jsPDF -- programmatic layout. Good for simple documents, bad for reports.
- **vs @react-pdf/renderer:** Decent option but limited CSS support. Puppeteer lets you use full CSS/HTML which you already know.
- **vs WeasyPrint (Python):** Would require a Python service. Not worth the operational complexity.

**Pattern:** Build report pages as regular HTML/React pages with a `?format=pdf` query param. Puppeteer visits the page and saves as PDF. This means you can also view reports in-browser.

### Queue & Scheduling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| BullMQ | 5.x | Job queue + scheduling | Redis-backed, supports delayed jobs, cron repeating jobs, retries, rate limiting. The standard for Node.js background jobs. |

**Why BullMQ over alternatives:**
- **vs node-cron:** node-cron is just a cron scheduler -- no persistence, no retries, no job tracking. If the process restarts, scheduled jobs are lost.
- **vs Agenda:** Agenda uses MongoDB as its backend. Since we're using PostgreSQL, adding MongoDB just for job scheduling is unnecessary overhead. BullMQ + Redis is lighter.
- **vs pg-boss:** pg-boss uses PostgreSQL as the queue backend (no Redis needed). Viable alternative if you want to avoid Redis, but BullMQ has better documentation, larger community, and built-in rate limiting which is critical for GBP API calls.

**Queue design:**
- `post-publish` queue: Scheduled posts with delayed execution
- `review-check` queue: Repeating cron job to poll for new reviews
- `review-respond` queue: AI-generated response drafts
- `report-generate` queue: Scheduled PDF report generation
- Rate limiter on all GBP API queues to respect Google's quotas

### Hosting & Infrastructure

| Technology | Purpose | Why |
|------------|---------|-----|
| Railway | App hosting (web + worker) | Supports multiple services (web server + background worker) from one repo. Built-in PostgreSQL and Redis add-ons. Cron jobs supported. Simple deploys from GitHub. |

**Why Railway over alternatives:**
- **vs Vercel:** Vercel is optimized for serverless/edge functions with a 10-second (free) or 60-second (pro) execution limit. Background jobs, long-running workers, and persistent connections to Redis don't fit the serverless model. Vercel is wrong for this project.
- **vs Render:** Render is a strong alternative. Similar to Railway but slightly more complex setup for multiple services. Either works -- Railway has slightly better DX for monorepo multi-service deploys.
- **vs Self-hosted (VPS):** Unnecessary operational burden for an internal tool. Railway abstracts away server management.
- **vs Fly.io:** Good option but more complex networking setup. Railway is simpler for this scale.

**Railway setup:**
- Service 1: Next.js web app
- Service 2: BullMQ worker process
- Add-on: PostgreSQL
- Add-on: Redis
- Estimated cost: ~$10-20/month at this scale

### Frontend Libraries

| Library | Purpose | Why |
|---------|---------|-----|
| Tailwind CSS | Styling | Fast development for internal tools. No need for a component library. |
| shadcn/ui | UI components | Copy-paste components built on Radix. Not a dependency -- just source code you own. Tables, forms, dialogs, etc. |
| TanStack Table | Data tables | Profile lists, post queues, review lists all need sortable/filterable tables |
| Recharts | Charts for reports | Simple React charting for dashboard metrics and PDF reports |
| next-auth (Auth.js) | Authentication | Google OAuth for team login. Simple setup with Next.js. |

### Google API

| Library | Purpose | Why |
|---------|---------|-----|
| googleapis | GBP API client | Official Google API Node.js client. Covers Business Profile API, OAuth2, and all other Google APIs from one package. |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Framework | Next.js | FastAPI + React | Two codebases, two deployments, more complexity |
| Framework | Next.js | Express + React | Same problem, plus no SSR/file-based routing benefits |
| Database | PostgreSQL | MongoDB | Data is relational; MongoDB adds unnecessary complexity |
| Database | PostgreSQL | SQLite | Cannot handle concurrent web + worker process writes |
| Queue | BullMQ | pg-boss | Viable but smaller community; BullMQ rate limiting is critical for API calls |
| Queue | BullMQ | node-cron | No persistence, no retries, no job tracking |
| PDF | Puppeteer | @react-pdf/renderer | Limited CSS support; Puppeteer uses full HTML/CSS |
| Hosting | Railway | Vercel | Serverless model incompatible with background workers |
| ORM | Prisma | Drizzle | Prisma has better migration tooling and more documentation |

## Installation

```bash
# Core framework
npx create-next-app@latest mapsai --typescript --tailwind --app --src-dir

# Database
npm install prisma @prisma/client
npm install -D prisma

# Queue & Redis
npm install bullmq ioredis

# AI
npm install @anthropic-ai/sdk

# Google APIs
npm install googleapis

# PDF
npm install puppeteer

# UI
npx shadcn-ui@latest init
npm install @tanstack/react-table recharts

# Auth
npm install next-auth

# Dev tools
npm install -D @types/node
```

## Sources

- Training data knowledge (May 2025 cutoff) -- all technologies listed are mature and stable
- Confidence: HIGH for core stack choices, MEDIUM for exact version numbers
- Note: Verify Google Business Profile API access requirements at https://developers.google.com/my-business before starting Phase 1
