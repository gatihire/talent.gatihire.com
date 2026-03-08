# Board App scalability notes

This repo is a Next.js app (App Router) with Supabase (DB/Auth/Storage) and a separate resume parsing worker.

## Target workload

- 100k+ signups
- 10k+ daily active users

## What scales “by default”

- Vercel/Next.js serverless scales horizontally for read-heavy traffic.
- Supabase Auth scales signups/logins if you are on an adequate plan.

The real bottlenecks usually become:

- Postgres query patterns (search, filters, polling)
- DB connection limits from serverless
- Large uploads going through API routes
- Background job processing reliability
- Observability (not knowing what failed)

## Recommended architecture

### 1) Web app

- Next.js on Vercel
- CDN caching for static assets
- Prefer server-side caching/revalidation for data that doesn’t change per-user

### 2) Database

- Supabase Postgres
- Use RLS + anon client for reads when possible
- Avoid service-role in public routes unless strictly necessary
- Add proper indexes (and consider FTS/trigram) for job search

### 3) Search

For scale, avoid large `ilike` OR queries across many columns.

Options:

- Postgres FTS (fastest to adopt, good for moderate scale)
- Dedicated search (Typesense/Meilisearch/Algolia/Elastic) when search becomes core

### 4) File uploads

Avoid uploading resumes via Next.js API routes at scale.

Preferred:

- API issues a signed upload URL
- Browser uploads directly to Supabase Storage
- API enqueues parse job with only `path` metadata

### 5) Background jobs

Current approach uses a Postgres-backed queue + a polling worker.

Keep it if:

- resume parsing volume is moderate
- you can reliably run and monitor the worker

Move to Redis queue (BullMQ) if:

- you need higher throughput
- you need delayed jobs, retries, DLQ, visibility, dashboards

### 6) Redis (optional, add when needed)

High-ROI uses:

- rate limiting for `/api/public/*`
- caching “hot” reads (job suggestions, job list pages)
- queue backend (BullMQ) if moving away from Postgres polling

## Operational checklist

- Add uptime monitoring against `/api/health`.
- Track worker liveness separately (process-level monitoring + alerts on stuck queue).
- Add error aggregation (Sentry or equivalent) for Next.js API + worker.
- Centralize logs (Axiom/Datadog/ELK) so `requestId` + errors are searchable.

## Quick wins already implemented

- `/api/health` endpoint for uptime checks.
- Candidate resume access can use a short-lived signed URL endpoint.
- Worker handles SIGTERM/SIGINT and logs failures.
- Reduced PII logging in resume parsing.

