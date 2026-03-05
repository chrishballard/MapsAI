# Phase 1: Project Scaffolding & Auth

## Goal
Standing Next.js app with database, auth, and basic dashboard layout.

## Success Criteria
- Can run `npm run dev` and see the app
- Can log in with email/password
- See empty dashboard with sidebar navigation (Profiles, Posts, Reviews, Reports, Settings)
- Database is connected with initial Prisma schema
- App is deployable to Railway

## Requirements Covered
- R6.1: Simple login (email/password) for internal team
- R6.4: Navigation: Profiles, Posts, Reviews, Reports, Settings

---

## Tasks

### Wave 1: Project Setup (no dependencies)

#### Task 1.1: Initialize Next.js Project
```
Prompt: Create a new Next.js 14+ project with App Router and TypeScript.

Steps:
1. npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
2. Verify the project runs with npm run dev
3. Clean up default boilerplate (remove default page content, keep layout structure)

Files created:
- package.json
- tsconfig.json
- next.config.ts
- src/app/layout.tsx
- src/app/page.tsx
- tailwind.config.ts
- postcss.config.js

Verify: npm run dev starts without errors
```

#### Task 1.2: Install Core Dependencies
```
Prompt: Install all dependencies needed for Phase 1.

Commands:
npm install prisma @prisma/client next-auth @auth/prisma-adapter bcryptjs
npm install -D @types/bcryptjs

Verify: package.json shows all dependencies
```

### Wave 2: Database & Schema (depends on 1.1, 1.2)

#### Task 1.3: Prisma Setup & Initial Schema
```
Prompt: Initialize Prisma with PostgreSQL and create the initial database schema.

Steps:
1. npx prisma init
2. Create schema with models needed for auth + future phases:

Models to create:
- User (id, email, name, passwordHash, role, createdAt, updatedAt)
- Account (NextAuth adapter model)
- Session (NextAuth adapter model)
- Profile (id, googleAccountId, name, placeId, address, phone, category, websiteUrl, isConnected, createdAt, updatedAt)

3. Create .env with DATABASE_URL placeholder
4. Add .env to .gitignore

Files:
- prisma/schema.prisma
- .env (gitignored)
- .env.example (committed, with placeholder values)

Verify: npx prisma validate passes
```

#### Task 1.4: Database Seed Script
```
Prompt: Create a seed script that creates a default admin user.

Steps:
1. Create prisma/seed.ts
2. Hash a default password with bcryptjs
3. Upsert a default admin user
4. Add seed script to package.json

Files:
- prisma/seed.ts
- package.json (add prisma.seed config)

Verify: Script compiles without errors
```

### Wave 3: Auth (depends on 1.3)

#### Task 1.5: NextAuth Configuration
```
Prompt: Set up NextAuth.js with credentials provider and Prisma adapter.

Steps:
1. Create auth configuration with credentials provider
2. Validate email/password against User table
3. Use Prisma adapter for session management
4. Configure JWT strategy (simpler for internal tool)
5. Add NEXTAUTH_SECRET and NEXTAUTH_URL to .env.example

Files:
- src/lib/auth.ts (NextAuth config)
- src/app/api/auth/[...nextauth]/route.ts
- .env.example (updated)

Verify: Auth routes respond at /api/auth/*
```

#### Task 1.6: Login Page
```
Prompt: Create a simple login page with email/password form.

Steps:
1. Create login page at /login
2. Simple centered card with email + password fields
3. Form submits via NextAuth signIn("credentials")
4. Redirect to /dashboard on success
5. Show error message on failure
6. Style with Tailwind (clean, minimal)

Files:
- src/app/login/page.tsx

Verify: Login page renders, form submits
```

### Wave 4: Dashboard Layout (depends on 1.5)

#### Task 1.7: Dashboard Layout with Sidebar
```
Prompt: Create the authenticated dashboard layout with sidebar navigation.

Steps:
1. Create dashboard layout with auth protection (redirect to /login if not authenticated)
2. Sidebar with navigation links:
   - Profiles (icon: Building2)
   - Posts (icon: FileText)
   - Reviews (icon: MessageSquare)
   - Reports (icon: BarChart3)
   - Settings (icon: Settings)
3. Top bar with user info and logout button
4. Main content area
5. Use lucide-react for icons
6. Mobile-responsive (sidebar collapses)

Dependencies to install: lucide-react

Files:
- src/app/dashboard/layout.tsx
- src/components/sidebar.tsx
- src/components/topbar.tsx

Verify: Sidebar renders with all nav links, logout works
```

#### Task 1.8: Dashboard Home Page (Empty State)
```
Prompt: Create the dashboard home page with empty state placeholder.

Steps:
1. Dashboard home at /dashboard
2. Show welcome message and empty state
3. Cards for key stats (all zeros for now): Total Profiles, Posts This Month, Pending Reviews, Reports Generated
4. "Connect your first Google Business Profile" CTA

Files:
- src/app/dashboard/page.tsx

Verify: Page renders with stats cards and CTA
```

#### Task 1.9: Placeholder Pages for Nav Items
```
Prompt: Create placeholder pages for each nav item so navigation works.

Steps:
1. /dashboard/profiles — "Profiles" heading + empty state
2. /dashboard/posts — "Posts" heading + empty state
3. /dashboard/reviews — "Reviews" heading + empty state
4. /dashboard/reports — "Reports" heading + empty state
5. /dashboard/settings — "Settings" heading + empty state

Files:
- src/app/dashboard/profiles/page.tsx
- src/app/dashboard/posts/page.tsx
- src/app/dashboard/reviews/page.tsx
- src/app/dashboard/reports/page.tsx
- src/app/dashboard/settings/page.tsx

Verify: All nav links route to their pages
```

### Wave 5: Deployment Config (depends on 1.1)

#### Task 1.10: Railway & Environment Config
```
Prompt: Add deployment configuration for Railway.

Steps:
1. Create Dockerfile (multi-stage build for Next.js)
2. Add .dockerignore
3. Create railway.toml with build and deploy config
4. Document required environment variables in README

Files:
- Dockerfile
- .dockerignore
- railway.toml
- README.md

Verify: Docker build succeeds locally (docker build .)
```

---

## Execution Order
1. **Wave 1** (parallel): Tasks 1.1, 1.2
2. **Wave 2** (parallel): Tasks 1.3, 1.4
3. **Wave 3** (parallel): Tasks 1.5, 1.6
4. **Wave 4** (parallel): Tasks 1.7, 1.8, 1.9
5. **Wave 5**: Task 1.10

## Commit Points
- After Wave 1+2: "feat: initialize Next.js project with Prisma schema"
- After Wave 3: "feat: add NextAuth credentials login"
- After Wave 4: "feat: add dashboard layout with sidebar navigation"
- After Wave 5: "feat: add Railway deployment config"

## Risk Mitigation
- If shadcn/ui is needed for components, install during Wave 4 (npx shadcn-ui@latest init)
- PostgreSQL required locally — if not available, use Docker: `docker run -p 5432:5432 -e POSTGRES_PASSWORD=mapsai postgres:16`
- If NextAuth v5 (Auth.js) is preferred over v4, adjust imports accordingly
