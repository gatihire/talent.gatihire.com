# GatiHire Board App Architecture & Feature Guide

This document explains the **candidate-facing board app** (Next.js 14) – how authentication works, how resumes and profiles are managed, how applications and invites flow, and how it connects back to the internal admin app and Supabase.

The goal is to give future developers a deep mental model of the system, not just surface-level React components.

---

## 1. High-Level Overview

The board app is a stand-alone Next.js 14 application deployed to Vercel (e.g. `https://test-board-app.vercel.app`).

It is responsible for the **candidate journey**:

- Signup / login (email + password or Google via Supabase Auth)
- Onboarding
  - Upload resume
  - AI-assisted parsing
  - Structured profile completion
- Ongoing profile editing (skills, experience, projects, availability)
- Discovering jobs
- Applying to jobs (with or without invite links)

Everything persists into the same Supabase project used by the internal app.

### 1.1 Simple System Map (Board App View)

```text
Candidate’s browser
    │
    │  visits board-app (Next.js 14)
    ▼
Board App
    │
    │  uses Supabase Auth + APIs
    ▼
Supabase
  - Auth: accounts, sessions
  - DB: candidates, jobs, applications, invites
    ▲
    │  admin-only service client
    ▼
Internal Admin App
  - creates jobs & invites
  - views pipeline & analytics
```

---

## 2. Repo Layout

Key directories:

- `app/`
  - `app/page.tsx` – Marketing-style landing entrypoint
  - `app/auth/*` – Auth and signup flows
  - `app/onboarding/page.tsx` – Candidate onboarding wizard
  - `app/dashboard/*` – Candidate dashboard pages (My work, Profile, Admin jobs view)
  - `app/jobs/*` – Public job listing and job details pages
  - `app/apply/[id]/page.tsx` – Auth + apply stepper for a specific job
  - `app/invite/[token]/page.tsx` – Invite token handler
  - `app/talent/[slug]/page.tsx` – Public candidate profile page
- `components/`
  - `auth/*` – Auth shell, Login and Signup forms
  - `onboarding/OnboardingFlow.tsx` – Onboarding wizard controller
  - `apply/*` – Apply flow components (steps, review, success)
  - `jobs/*` – Job listing and job apply components
  - `dashboard/*` – Candidate dashboard and profile editor
  - `shell/DashboardShell.tsx` – Shared dashboard layout
  - `ui/*` – Button, Input, Card, Modal, Spinner, Badge, etc.
- `lib/`
  - `supabase.ts` – Supabase browser client
  - `supabaseAdmin.ts` – Supabase server-side service client (for APIs)
  - `supabaseSsr.ts` – Helper for middleware and server routes
  - `useSupabaseSession.ts` – Client-side hook wrapping Supabase Auth helpers
  - `types.ts` – Shared strongly-typed shapes for candidates, jobs, parsing jobs, etc.
  - `resume-parser.ts` – AI-powered resume parsing shared with internal app
  - `regexPatterns.ts` – Common regex utilities
  - `returnTo.ts` – Utility to sanitize `returnTo` redirect paths

---

## 3. Authentication & Routing

### 3.1 Supabase Auth

The board app uses **Supabase Auth** in standard email+password + OAuth (Google) mode.

**Important components**

- [components/auth/SignupForm.tsx](../components/auth/SignupForm.tsx)
- [components/auth/LoginForm.tsx](../components/auth/LoginForm.tsx)
- [components/auth/AuthPanel.tsx](../components/auth/AuthPanel.tsx)
- [components/apply/AuthStep.tsx](../components/apply/AuthStep.tsx) – inline auth step in apply wizard
- [lib/useSupabaseSession.ts](../lib/useSupabaseSession.ts)
- [app/auth/callback/route.ts](../app/auth/callback/route.ts)
- [middleware.ts](../middleware.ts)

**Email/password signup**

- `SignupForm` calls `supabase.auth.signUp` with:
  - `email`
  - `password`
  - `options`:
    - `emailRedirectTo = ${origin}/auth/callback?returnTo=...`
    - `data: { full_name }`
- **Origin resolution**:
  - Uses `NEXT_PUBLIC_SITE_URL` if set; falls back to `window.location.origin`.
  - This ensures verification links redirect back to the production domain instead of `localhost`.

**Login**

- `LoginForm` uses `supabase.auth.signInWithPassword`.
- Google login path uses `supabase.auth.signInWithOAuth` with `redirectTo` built the same way as above.
- After password login, router navigates to `returnTo` (default `/jobs`).

**Auth callback**

- `/auth/callback` route:
  - Reads `code` and `returnTo` from query.
  - Uses `createSupabaseMiddlewareClient` to exchange code for session.
  - Redirects to `returnTo` (default `/jobs`).

**Middleware**

- `middleware.ts` protects dashboard routes and normalizes redirects based on auth state.
  - Unauthed hitting dashboard routes → redirected to `/auth/login?returnTo=...`.

**Key production consideration**

- Supabase **Site URL** must be set to the board app’s base URL.
- Supabase **Additional Redirect URLs** must include:
  - `https://<board-domain>/auth/callback`
  - possibly `https://<board-domain>/**` for convenience.
- Vercel project must set `NEXT_PUBLIC_SITE_URL` to the board domain.

---

## 4. Onboarding Flow

**Files**

- [app/onboarding/page.tsx](../app/onboarding/page.tsx)
- [components/onboarding/OnboardingFlow.tsx](../components/onboarding/OnboardingFlow.tsx)
- [components/apply/ResumeStep.tsx](../components/apply/ResumeStep.tsx)
- [components/apply/ProfileStep.tsx](../components/apply/ProfileStep.tsx)
- [lib/resume-parser.ts](../lib/resume-parser.ts)
- Candidate API routes:
  - [app/api/candidate/profile/route.ts](../app/api/candidate/profile/route.ts)
  - [app/api/candidate/resume/parse/route.ts](../app/api/candidate/resume/parse/route.ts)
  - [app/api/candidate/resume/status/route.ts](../app/api/candidate/resume/status/route.ts)

**Steps**

1. **Resume step**
   - Candidate uploads resume.
   - `ResumeStep` calls `/api/candidate/resume/parse` (multipart form with `resume`).
   - API stores file (via Supabase storage), triggers parse via `lib/resume-parser.ts`, and returns:
     - `candidate` record (upserted in Supabase `candidates` table)
     - `parsingJob` metadata when parsing is asynchronous.
2. **Profile step**
   - `ProfileStep` shows structured fields (name, role, experience, skills, projects) seeded from parse output.
   - On save, calls `/api/candidate/profile` (PUT) to update candidate profile.

**OnboardingFlow coordination**

- Manages step state (`resume` vs `profile`).
- Uses `useSupabaseSession` for auth context.
- Fetches candidate profile (`fetchProfile` callback) when access token is available.
- If no candidate exists, auto-creates a minimal candidate using Supabase user metadata (full name) to avoid friction.

---

## 5. Candidate Dashboard & Profile

**Files**

- [app/dashboard/page.tsx](../app/dashboard/page.tsx) – entry
- [app/dashboard/profile/page.tsx](../app/dashboard/profile/page.tsx)
- [components/dashboard/CandidateDashboard.tsx](../components/dashboard/CandidateDashboard.tsx)
- [components/dashboard/ProfileBraintrust.tsx](../components/dashboard/ProfileBraintrust.tsx)
- [components/dashboard/ProfileEditor.tsx](../components/dashboard/ProfileEditor.tsx)
- [components/dashboard/WorkAvailabilityModal.tsx](../components/dashboard/WorkAvailabilityModal.tsx)
- [app/api/candidate/availability/route.ts](../app/api/candidate/availability/route.ts)

**Profile structure**

- `ProfileBraintrust` is the main component for editing:
  - Personal details
  - Experience
  - Skills
  - Projects
  - Public profile visibility

**Structured Projects**

- Projects are stored as JSON objects inside `candidates.projects`, not just strings.
  - Each project has: `title`, optional `description`, optional `link`.
- Profile UI renders projects as cards with title, description, and optional external link.
- Public talent page (`/talent/[slug]`) uses the same structured representation.

**Work Availability**

- `WorkAvailabilityModal` manages:
  - `looking_for_work` (boolean)
  - `open_job_types` (full-time, part-time, direct hire, contract)
  - `available_start_time`, `available_end_time`
  - `work_timezone`
  - **Preferred location** (new field `candidates.preferred_location`)
- API (`/api/candidate/availability`) upserts into `candidates` with RLS-safe patterns.

---

## 6. Job Discovery & Apply Flow

### 6.1 Jobs Listing

**Files**

- [app/jobs/page.tsx](../app/jobs/page.tsx)
- [components/jobs/JobsBoardClient.tsx](../components/jobs/JobsBoardClient.tsx)
- [components/jobs/JobsFilters.tsx](../components/jobs/JobsFilters.tsx)
- [components/jobs/JobCard.tsx](../components/jobs/JobCard.tsx)
- [app/api/jobs/*] – same backend jobs as internal app

The Board app reads from the same `jobs` table via public (RLS-protected) APIs exposed from the internal app.

### 6.2 Apply Flow

**Files**

- [app/jobs/[id]/apply/page.tsx](../app/jobs/%5Bid%5D/apply/page.tsx)
- [components/jobs/JobApplyPageClient.tsx](../components/jobs/JobApplyPageClient.tsx)
- [components/jobs/JobApplyForm.tsx](../components/jobs/JobApplyForm.tsx)
- [components/apply/ApplyStepper.tsx](../components/apply/ApplyStepper.tsx)
- [components/apply/AuthStep.tsx](../components/apply/AuthStep.tsx)
- [components/apply/ProfileStep.tsx](../components/apply/ProfileStep.tsx)
- [components/apply/ReviewStep.tsx](../components/apply/ReviewStep.tsx)
- [components/apply/ApplySuccess.tsx](../components/apply/ApplySuccess.tsx)
- [app/api/candidate/applications/submit/route.ts](../app/api/candidate/applications/submit/route.ts)

**Stages**

1. **Auth step (AuthStep)**
   - If user is not logged in, they must sign in via password or Google.
   - OAuth uses the current site origin for the callback URL (avoids localhost redirects in production).
2. **Resume/profile review**
   - Reuses onboarding components where necessary.
3. **Review & submit**
   - Submits to `/api/candidate/applications/submit`.
   - Endpoint creates `applications` row, associates with job and candidate, and marks invite `status=applied` when `inviteToken` is provided.

---

## 7. Invite Flow (Board App Side)

**Files**

- [app/invite/[token]/page.tsx](../app/invite/%5Btoken%5D/page.tsx)
- [app/api/candidate/invites/route.ts](../app/api/candidate/invites/route.ts)
- [components/dashboard/MyWork.tsx](../components/dashboard/MyWork.tsx)

### 7.1 Invite Link Handling

- When a candidate opens an invite link from email:
  - URL pattern: `/invite/:token` on board app.
  - Server component:
    - Looks up `job_invites` by token.
    - If not found → redirect to `/jobs`.
    - If found:
      - If `opened_at` is null, sets `opened_at` + transitions `status` from `sent` → `opened`.
      - Redirects to `/jobs/:jobId/apply?invite=${token}`.

### 7.2 Candidate Invites Tab (My Work)

- `MyWork` component fetches candidate-specific invites via `/api/candidate/invites`.
  - API resolves candidate by Supabase user (auth user id + email) and selects from `job_invites` where candidate_id or email matches.
- UI shows each invite with:
  - Job title + location
  - Status pill (sent/opened/applied/rejected)
  - "Apply" button linking either:
    - `/invite/:token` (preferred), or
    - fallback `/jobs/:jobId/apply` if token missing.
  - "Reject" button – sets `status=rejected` via `/api/candidate/invites` POST with `{ action: "reject" }`.

### 7.3 Application Submission with Invite Token

- Apply form (`JobApplyForm`) reads `invite` from query string and passes `inviteToken` to `/api/candidate/applications/submit`.
- Submit API updates matching `job_invites` record:
  - Sets `status="applied"`, `applied_at` and `responded_at`, and links `candidate_id`.

This gives a full trail: admin sees invites pipeline in internal app; candidate sees invites in My Work; both sides synchronize via `job_invites` table.

---

## 8. Resume Parsing

**Files**

- [lib/resume-parser.ts](../lib/resume-parser.ts)
- [app/api/candidate/resume/parse/route.ts](../app/api/candidate/resume/parse/route.ts)
- [app/api/candidate/resume/status/route.ts](../app/api/candidate/resume/status/route.ts)

**Implementation notes**

- Uses `pdf-parse`, `mammoth` (for DOCX), and `jszip` where needed.
- Type definitions are provided via `@types/pdf-parse` to keep build clean.
- Parsing extracts:
  - Name, email, phone
  - Work experience
  - Education
  - Skills
  - Summary
- Parsed data is merged into `candidates` table; manual edits override later.

---

## 9. Environment Variables (Board App)

Board-app specific env vars (set in Vercel and local `.env.local`):

- Supabase
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (for server routes only)

- Site URL
  - `NEXT_PUBLIC_SITE_URL` – base external URL of board app (e.g. `https://test-board-app.vercel.app`). Used to construct Supabase Auth redirect URLs.

- AI / Gemini
  - `GEMINI_API_KEY`

For local development, `NEXT_PUBLIC_SITE_URL` can be `http://localhost:3000` so that signup links work even if you open them from an email client outside your browser.

---

## 10. How to Extend Safely

1. **Follow existing patterns**
   - For API routes, reuse the patterns in existing candidate endpoints: `getAuthedUser` for auth, narrow selects, RLS friendly access.
2. **Keep board app read/write limited**
   - The board app should only interact with candidate-owned data and public job data; job creation and admin-only features live in the internal app.
3. **Check `npm run lint` and `npm run build` before pushing**
   - The repo is configured to treat TypeScript errors as build blockers; hooks and Next.js rules are enforced.
4. **When adding new user-visible flows**
   - Think from the candidate perspective: minimal friction, clear questions, clear error states.
   - Pair every new UI component with an API route and, where possible, a Supabase migration documenting new fields.
