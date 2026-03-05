# MapsAI

AI-powered Google Business Profile management tool for Vineyard Growth.

## Features
- AI-generated GBP posts with approval workflow
- Automated review responses
- Performance analytics and PDF reporting
- Multi-profile management (100-200 profiles)

## Setup

### Prerequisites
- Node.js 20+
- PostgreSQL 16+

### Install
```bash
npm install
cp .env.example .env
# Edit .env with your database URL and secrets
```

### Database
```bash
# If you need a local PostgreSQL instance:
docker run -d --name mapsai-db -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mapsai postgres:16

# Run migrations and seed
npx prisma migrate dev
npx prisma db seed
```

### Run
```bash
npm run dev
```

Default login: `admin@vineyardgrowth.com` / `mapsai2026`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Random secret for session encryption |
| `NEXTAUTH_URL` | App URL (http://localhost:3000 for dev) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (Phase 2) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret (Phase 2) |
| `ANTHROPIC_API_KEY` | Claude API key (Phase 3) |

## Deploy to Railway
1. Push to GitHub
2. Connect repo in Railway
3. Add PostgreSQL and Redis services
4. Set environment variables
5. Deploy
