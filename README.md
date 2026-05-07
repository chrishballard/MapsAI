# MapsAI

AI-powered Google Business Profile management tool — manages posts, review responses, performance analytics, and PDF reporting across 100-200 profiles.

## Features
- AI-generated GBP posts with approval workflow
- Automated review responses
- Performance analytics and PDF reporting
- Multi-profile management

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

# Run migrations
npx prisma migrate dev

# Seed an admin user. Either set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD,
# or run with no env vars and the script will print a generated password once.
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='choose-a-strong-one' npx prisma db seed
```

### Run
```bash
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Random secret for session encryption |
| `NEXTAUTH_URL` | App URL (http://localhost:3000 for dev) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (Phase 2) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret (Phase 2) |
| `ANTHROPIC_API_KEY` | Claude API key (Phase 3) |
| `SEED_ADMIN_EMAIL` | (optional) Email for the seeded admin user |
| `SEED_ADMIN_PASSWORD` | (optional) Password for the seeded admin user; if unset, a random one is generated and printed |

## Deploy to Railway
1. Push to GitHub
2. Connect repo in Railway
3. Add PostgreSQL and Redis services
4. Set environment variables
5. Deploy
