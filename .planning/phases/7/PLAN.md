---
phase: 07-polish-production-readiness
plan: 01
type: execute
wave: 1
depends_on: [06-analytics-pdf-reporting]
files_modified:
  - src/app/dashboard/page.tsx
  - src/app/dashboard/profiles/[id]/page.tsx
  - src/app/dashboard/settings/page.tsx
  - src/app/dashboard/settings/prompt-templates.tsx
  - workers/index.ts
  - Dockerfile
  - scripts/start.sh
autonomous: true
requirements: [R6.2, R6.3, R6.5]

must_haves:
  truths:
    - "Dashboard home shows live aggregate stats (profiles, posts, reviews, reports)"
    - "Profile detail page shows unified view of posts, reviews, and metrics for one profile"
    - "Settings page includes prompt template management section"
    - "Unified worker entry point starts all workers (publish, review-sync, review-publish, metrics-sync)"
    - "Dockerfile and start script run both Next.js and workers"
  artifacts:
    - path: "src/app/dashboard/page.tsx"
      provides: "Dashboard with live aggregate stats"
    - path: "src/app/dashboard/profiles/[id]/page.tsx"
      provides: "Profile detail page with posts, reviews, metrics"
    - path: "src/app/dashboard/settings/prompt-templates.tsx"
      provides: "Prompt template management UI"
    - path: "workers/index.ts"
      provides: "Unified worker entry point"
    - path: "Dockerfile"
      provides: "Production Docker config"
---

<objective>
Polish the dashboard, add profile detail pages, complete settings, and prepare for production deployment.

Purpose: This is the final phase that ties everything together into a cohesive production tool. The dashboard gets live stats, each profile gets a detail page showing all its data, settings gets prompt template management, and the deployment is containerized with all workers.

Output: Production-ready application where the team can manage 100-200 profiles end-to-end from a single dashboard.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
@prisma/schema.prisma
@src/app/dashboard/page.tsx
@src/app/dashboard/profiles/page.tsx
@src/app/dashboard/settings/page.tsx

<interfaces>
Existing dashboard pages: profiles, posts, reviews, reports, settings
Existing Prisma models: Profile, Post, Review, ReviewResponse, DailyMetric, MonthlyKeyword, Report, PromptTemplate
Workers: workers/publish-worker.ts, workers/review-sync-worker.ts, workers/review-publish-worker.ts, workers/metrics-sync-worker.ts
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Dashboard home with live stats and profile detail page</name>
  <files>
    src/app/dashboard/page.tsx,
    src/app/dashboard/profiles/[id]/page.tsx
  </files>
  <action>
    **1. Update src/app/dashboard/page.tsx with live aggregate stats:**
    Replace the hardcoded "0" values with actual Prisma queries:
    - Total Profiles: prisma.profile.count()
    - Posts This Month: prisma.post.count where createdAt >= start of current month
    - Pending Reviews: prisma.reviewResponse.count where status = DRAFTED
    - Reports Generated: prisma.report.count()

    Add a "Recent Activity" section below the stats:
    - Last 5 posts generated (profile name, type, date)
    - Last 5 reviews received (profile name, rating, date)
    - Compact card list, link each to the relevant page

    Keep existing layout structure, just replace placeholder data with real queries.

    **2. Create src/app/dashboard/profiles/[id]/page.tsx (profile detail page):**
    Server component showing unified view for a single profile:

    **Header:** Profile name, category badge, address, connection status, Google account email

    **Stats row:** 4 metric boxes (same pattern as dashboard):
    - Total Posts (count)
    - Draft Posts (count where status=DRAFT)
    - Reviews (count)
    - Avg Rating (from reviews)

    **Tabs/Sections** (use anchor links or just stacked sections):

    **Posts section:**
    - Last 10 posts for this profile (card grid, same style as posts page)
    - "View All Posts" link to /dashboard/posts?profileId={id}
    - "Generate Posts" button linking to /dashboard/posts/generate

    **Reviews section:**
    - Last 10 reviews for this profile with AI responses
    - Star rating, reviewer name, comment preview, response status
    - "View All Reviews" link to /dashboard/reviews?profileId={id}

    **Metrics section (if any DailyMetric data exists):**
    - Simple summary: total impressions, clicks, calls, directions for current month
    - "View Reports" link to /dashboard/reports

    **Also update the profiles list page** to make profile names clickable links to /dashboard/profiles/{id}.
  </action>
  <verify>
    <automated>npm run build 2>&1 | tail -10</automated>
  </verify>
  <done>
    - Dashboard shows live stats from database
    - Recent activity section shows latest posts and reviews
    - Profile detail page shows all data for a single profile
    - Profile names are links in the profiles list
    - Build succeeds
  </done>
</task>

<task type="auto">
  <name>Task 2: Settings prompt templates and unified worker</name>
  <files>
    src/app/dashboard/settings/page.tsx,
    src/app/dashboard/settings/prompt-templates.tsx,
    src/app/api/prompt-templates/route.ts,
    src/app/api/prompt-templates/[id]/route.ts,
    workers/index.ts,
    Dockerfile,
    scripts/start.sh
  </files>
  <action>
    **1. Add prompt template management to settings:**

    Create src/app/api/prompt-templates/route.ts:
    - GET: list all prompt templates (include profile name if linked)
    - POST: create new template { name, prompt, profileId?, category?, isDefault? }

    Create src/app/api/prompt-templates/[id]/route.ts:
    - PATCH: update template content
    - DELETE: delete template

    Create src/app/dashboard/settings/prompt-templates.tsx:
    Client component for managing prompt templates:
    - List existing templates with name, category/profile, preview of prompt text
    - "Add Template" form: name, category dropdown (or profile selector), prompt textarea
    - Edit and delete buttons per template
    - Use router.refresh() after mutations

    Update src/app/dashboard/settings/page.tsx:
    - Keep existing "Connected Google Accounts" section
    - Add "AI Prompt Templates" section below it using the PromptTemplates client component
    - Fetch existing templates via Prisma in the server component, pass as props

    **2. Create workers/index.ts (unified worker entry point):**
    Single file that imports and starts all workers:
    - Import publish-worker logic
    - Import review-sync-worker logic
    - Import review-publish-worker logic
    - Import metrics-sync-worker logic
    - Initialize schedulers (review sync + metrics sync)
    - Console.log startup message for each worker
    - Handle graceful shutdown on SIGTERM/SIGINT

    **3. Create scripts/start.sh:**
    ```bash
    #!/bin/sh
    # Start workers in background
    node --import tsx workers/index.ts &
    WORKER_PID=$!
    # Start Next.js
    npm run start &
    NEXT_PID=$!
    # Wait for either to exit
    wait -n $WORKER_PID $NEXT_PID
    kill $WORKER_PID $NEXT_PID 2>/dev/null
    exit 1
    ```

    **4. Create Dockerfile:**
    Multi-stage build:
    - Stage 1: Install dependencies + build Next.js
    - Stage 2: Production image with built app + workers
    - Install system deps for canvas (cairo, pango) if needed
    - Copy scripts/start.sh as entrypoint
    - Expose port 3000
  </action>
  <verify>
    <automated>npm run build 2>&1 | tail -10</automated>
  </verify>
  <done>
    - Settings page has prompt template management
    - CRUD API for prompt templates works
    - Unified worker entry point starts all 4 workers
    - Dockerfile builds the app for production
    - Start script runs Next.js + workers together
    - Build succeeds
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Production polish: live dashboard stats, profile detail pages, prompt template settings, unified worker process, Docker deployment config.
  </what-built>
  <how-to-verify>
    1. npm run dev
    2. Dashboard (/) should show live counts for profiles, posts, reviews, reports
    3. Click a profile name in /dashboard/profiles to see the detail page
    4. Check /dashboard/settings for prompt template management
    5. Verify workers/index.ts starts without errors: npx tsx workers/index.ts
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
- TypeScript compiles: `npx tsc --noEmit`
- App builds: `npm run build`
- Dashboard shows live stats
- Profile detail page renders
- Prompt template CRUD works
- Unified worker starts all workers
</verification>

<success_criteria>
- Dashboard home shows real-time aggregate stats
- Profile detail page provides unified view of posts, reviews, metrics
- Settings page manages connected accounts AND prompt templates
- Unified worker process runs all background jobs
- Dockerfile and start script ready for Railway deployment
- Build and TypeScript compilation succeed
</success_criteria>

<output>
After completion, create `.planning/phases/7/07-01-SUMMARY.md`
</output>
