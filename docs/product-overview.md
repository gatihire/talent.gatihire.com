# GatiHire Board App – Product Overview (Non‑Technical)

This document explains the candidate‑facing **GatiHire Board App** in simple language so that non‑technical people can understand what the app does.

If you also want the internal recruiter/admin view, see the internal repo:

- Internal product + architecture docs: `https://github.com/bipulsikder/test_internal_tzy` (docs folder)

---

## 1. What the Board App Is

The Board App is the website candidates use to:

- Create an account (email/password or Google)
- Upload their resume once and get an auto‑filled profile
- Maintain a structured profile (skills, work history, projects)
- Browse logistics jobs
- Apply in a few clicks
- Receive and respond to recruiter invite links

---

## 2. Simple System Map

```text
Candidate’s browser
    │
    │  uses Board App (Next.js)
    ▼
Board App
    │
    │  Auth + data storage
    ▼
Supabase
  - Auth (accounts)
  - Database (candidates, jobs, applications, invites)
  - Storage (resumes)
```

---

## 3. Candidate Journey (Story)

### 3.1 Sign up

1. Candidate opens the Board App URL.
2. Candidate signs up with email/password or Google.
3. Supabase sends a verification link.
4. After verification, candidate returns to the Board App and continues.

Key point: the redirect should always go back to the hosted domain (not localhost). In production you must set:

- Supabase Auth Site URL
- Supabase Additional Redirect URLs
- Vercel env `NEXT_PUBLIC_SITE_URL`

### 3.2 Onboarding

1. Upload resume.
2. Board App parses it and auto‑fills a profile.
3. Candidate reviews and edits profile.

### 3.3 Apply to a job

1. Candidate browses jobs.
2. Opens a job.
3. Clicks Apply.
4. Board App submits the application and stores it in the database.

### 3.4 Invites

1. Recruiter sends invite to candidate’s email.
2. Candidate clicks invite link.
3. Board App records the invite as opened and sends candidate to apply.
4. If candidate applies, invite status updates to applied.

---

## 4. What Stakeholders Should Know

### What makes it different

- Resume upload → structured profile reduces drop‑off
- Invite links are tracked (opened/applied) so recruiters know what happened
- Built around logistics roles and terminology (Car Carrier, Reefer, Dispatch, etc.)

### Main outcomes

- Candidates apply faster
- Recruiters get higher signal earlier
- End‑to‑end traceability from invite → application

