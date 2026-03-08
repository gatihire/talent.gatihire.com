"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { Candidate, Job, ParsingJob } from "@/lib/types"
import { getAttribution } from "@/lib/attribution"
import { useSupabaseSession } from "@/lib/useSupabaseSession"
import { useRouter, useSearchParams } from "next/navigation"
import { Badge } from "@/components/ui/Badge"
import { AuthStep } from "@/components/apply/AuthStep"
import { ResumeStep } from "@/components/apply/ResumeStep"
import { ProfileStep } from "@/components/apply/ProfileStep"
import { ReviewStep } from "@/components/apply/ReviewStep"
import { ApplySuccess } from "@/components/apply/ApplySuccess"
import { ProfileSetupSuccess } from "@/components/apply/ProfileSetupSuccess"
import { bearerHeaders, cachedFetchJson, invalidateSessionCache } from "@/lib/http"

type Step = "auth" | "resume" | "profile" | "review" | "done"

type Mode = "apply" | "profile"

export function ApplyStepper({
  job,
  mode = "apply",
  returnTo,
  authRequireConsent = true,
  onClose,
}: {
  job?: Job
  mode?: Mode
  returnTo?: string
  authRequireConsent?: boolean
  onClose?: () => void
}) {
  const { session, loading } = useSupabaseSession()
  const accessToken = session?.access_token
  const sessionUserId = (session as any)?.user?.id ? String((session as any).user.id) : ""
  const router = useRouter()
  const sp = useSearchParams()

  const inviteToken = useMemo(() => {
    const v = (sp.get("invite") || "").trim()
    return v || ""
  }, [sp])

  const [step, setStep] = useState<Step>("auth")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [parsingJob, setParsingJob] = useState<ParsingJob | null>(null)
  const [coverLetter, setCoverLetter] = useState("")
  const [applicationId, setApplicationId] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!session) setStep("auth")
    else setStep("resume")
  }, [loading, session])

  const fetchProfile = useCallback(async () => {
    if (!accessToken) return
    setCandidateLoading(true)
    setError(null)
    try {
      const data = await cachedFetchJson<any>(
        `boardapp:candidateProfile:${sessionUserId || "anon"}`,
        "/api/candidate/profile",
        { headers: bearerHeaders(accessToken) },
        { ttlMs: 5 * 60_000 },
      )
      setCandidate(data.candidate || null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCandidateLoading(false)
    }
  }, [accessToken, sessionUserId])

  useEffect(() => {
    if (!accessToken) return
    fetchProfile()
  }, [accessToken, fetchProfile])

  useEffect(() => {
    if (!accessToken || !parsingJob?.id) return
    // Don't poll if already finished
    if (parsingJob.status === "completed" || parsingJob.status === "failed") return

    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (stopped) return
      try {
        const res = await fetch(`/api/candidate/resume/status?parsing_job_id=${parsingJob.id}`, {
          headers: bearerHeaders(accessToken)
        })
        if (res.status === 404) {
          console.error("Parsing job not found:", parsingJob.id)
          return // Stop polling if not found
        }
        const data = await res.json()
        if (res.ok && data?.parsingJob) {
          const next = data.parsingJob as ParsingJob
          setParsingJob(next)
          if (next.status === "completed" || next.status === "failed") {
            invalidateSessionCache("boardapp:candidateProfile:", { prefix: true })
            await fetchProfile()
            return
          }
        }
      } catch (e) {
        console.error("Polling error:", e)
      }
      timer = setTimeout(poll, 4000) // Even more relaxed polling
    }

    poll()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [accessToken, parsingJob?.id, parsingJob?.status, fetchProfile])

  const needsResume = !candidate?.file_url
  const requiredMissing = !candidate?.current_role || !candidate?.location || !candidate?.total_experience || !candidate?.name

  const uploadAndParse = async (file: File) => {
    if (!accessToken) return
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("resume", file)
      const res = await fetch("/api/candidate/resume/parse", {
        method: "POST",
        body: fd,
        headers: bearerHeaders(accessToken)
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = String(data?.error || "Failed to parse")
        const st = typeof data?.stage === "string" && data.stage.trim() ? data.stage.trim() : ""
        throw new Error(st ? `${msg} (stage: ${st})` : msg)
      }
      if (data.candidate) setCandidate(data.candidate)
      if (data.parsingJob) setParsingJob(data.parsingJob)
      invalidateSessionCache("boardapp:candidateProfile:", { prefix: true })
      invalidateSessionCache("boardapp:jobsSearch:", { prefix: true })
      setStep("profile")
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const parseExisting = async () => {
    if (!accessToken) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/candidate/resume/reparse", { method: "POST", headers: bearerHeaders(accessToken) })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const msg = String(data?.error || "Failed to start parsing")
        throw new Error(msg)
      }
      if (data?.parsingJob) setParsingJob(data.parsingJob)
      setStep("profile")
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const saveProfile = async (next: Candidate, nextStep: Step) => {
    if (!accessToken) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/candidate/profile", {
        method: "PUT",
        headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: next.name,
          email: next.email,
          phone: next.phone,
          looking_for_work: next.looking_for_work,
          current_salary: next.current_salary,
          expected_salary: next.expected_salary,
          tags: next.tags
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save")
      setCandidate(data.candidate)
      invalidateSessionCache("boardapp:candidateProfile:", { prefix: true })
      invalidateSessionCache("boardapp:jobsSearch:", { prefix: true })
      setStep(nextStep)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (mode !== "apply") return
    if (!job) return
    if (!accessToken) return
    setBusy(true)
    setError(null)

    try {
      const attr = getAttribution()
      const res = await fetch("/api/candidate/applications/submit", {
        method: "POST",
        headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ jobId: job.id, coverLetter, attribution: attr, inviteToken: inviteToken || null })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to submit")
      if (data?.applicationId) setApplicationId(String(data.applicationId))
      invalidateSessionCache("boardapp:applications:", { prefix: true })
      if (inviteToken) {
        try {
          const url = new URL(window.location.href)
          url.searchParams.delete("invite")
          const qs = url.searchParams.toString()
          router.replace(qs ? `${url.pathname}?${qs}` : url.pathname)
        } catch {
        }
      }
      setStep("done")
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const steps = useMemo(() => {
    if (mode === "profile") {
      return [
        { id: "auth", label: "1. Sign in" },
        { id: "resume", label: "2. Resume" },
        { id: "profile", label: "3. Autofill" },
        { id: "review", label: "4. Finish" }
      ]
    }
    return [
      { id: "auth", label: "1. Sign in" },
      { id: "resume", label: "2. Resume" },
      { id: "profile", label: "3. Autofill" },
      { id: "review", label: "4. One‑tap apply" }
    ]
  }, [mode])

  if (step === "done") return mode === "profile" ? <ProfileSetupSuccess returnTo={returnTo} /> : <ApplySuccess applicationId={applicationId} />

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {steps.map((s) => (
          <Badge key={s.id} className={step === s.id ? "bg-primary/5 border-primary/20 text-foreground" : ""}>
            {s.label}
          </Badge>
        ))}
      </div>

      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</div> : null}

      {step === "auth" ? (
        <AuthStep
          jobId={job?.id || "__profile__"}
          returnTo={returnTo}
          requireConsent={authRequireConsent}
          title={mode === "profile" ? "Create your profile" : "Upload your CV to apply"}
          description={
            mode === "profile"
              ? "Sign in, upload your resume, and review details in under 2 minutes."
              : "Create your profile once for faster applications to logistics jobs."
          }
          onError={setError}
        />
      ) : null}

      {step === "resume" ? (
        <ResumeStep
          candidate={candidate}
          candidateLoading={candidateLoading}
          busy={busy}
          parsingJob={parsingJob}
          onError={setError}
          onUploadAndParse={uploadAndParse}
          onParseExisting={parseExisting}
          onSkip={() => setStep(mode === "profile" ? "profile" : requiredMissing ? "profile" : "review")}
        />
      ) : null}

      {step === "profile" ? (
        <ProfileStep
          candidate={candidate}
          setCandidate={(next) => setCandidate(next)}
          busy={busy}
          onBack={() => setStep("resume")}
          onContinue={() => {
            if (!candidate) return
            saveProfile(candidate, mode === "profile" ? "review" : "review")
          }}
        />
      ) : null}

      {step === "review" ? (
        mode === "profile" ? (
          <div className="grid gap-4 rounded-2xl border bg-card px-6 pb-6 pt-6">
            <div>
              <div className="text-base font-semibold">Profile ready</div>
              <div className="mt-1 text-sm text-muted-foreground">Review what we extracted from your resume. You can edit anytime.</div>
            </div>

            {candidate ? (
              <div className="grid gap-4 rounded-2xl border bg-accent p-5">
                <div>
                  <div className="text-base font-semibold">{candidate.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {candidate.email}
                    {candidate.phone ? ` • ${candidate.phone}` : ""}
                  </div>
                </div>

                <div className="grid gap-3">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Current</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {candidate.current_role ? <span className="rounded-full border bg-background px-3 py-1 text-xs">{candidate.current_role}</span> : null}
                      {candidate.current_company ? <span className="rounded-full border bg-background px-3 py-1 text-xs">{candidate.current_company}</span> : null}
                      {candidate.total_experience ? <span className="rounded-full border bg-background px-3 py-1 text-xs">{candidate.total_experience}</span> : null}
                      {candidate.location ? <span className="rounded-full border bg-background px-3 py-1 text-xs">{candidate.location}</span> : null}
                      {candidate.preferred_location ? <span className="rounded-full border bg-background px-3 py-1 text-xs">Preferred: {candidate.preferred_location}</span> : null}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Education</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {candidate.highest_qualification ? <span className="rounded-full border bg-background px-3 py-1 text-xs">{candidate.highest_qualification}</span> : null}
                      {candidate.degree ? <span className="rounded-full border bg-background px-3 py-1 text-xs">{candidate.degree}</span> : null}
                      {candidate.specialization ? <span className="rounded-full border bg-background px-3 py-1 text-xs">{candidate.specialization}</span> : null}
                      {candidate.university ? <span className="rounded-full border bg-background px-3 py-1 text-xs">{candidate.university}</span> : null}
                    </div>
                  </div>

                  {candidate.summary ? (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Summary</div>
                      <div className="mt-2 rounded-2xl border bg-background px-4 py-3 text-sm text-muted-foreground whitespace-pre-wrap">{candidate.summary}</div>
                    </div>
                  ) : null}

                  {Array.isArray(candidate.technical_skills) && candidate.technical_skills.length ? (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Skills</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {candidate.technical_skills.slice(0, 30).map((s) => (
                          <span key={s} className="rounded-full border bg-background px-3 py-1 text-xs">{s}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {Array.isArray(candidate.soft_skills) && candidate.soft_skills.length ? (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Soft skills</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {candidate.soft_skills.slice(0, 30).map((s) => (
                          <span key={s} className="rounded-full border bg-background px-3 py-1 text-xs">{s}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {Array.isArray(candidate.languages_known) && candidate.languages_known.length ? (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Languages</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {candidate.languages_known.slice(0, 15).map((s) => (
                          <span key={s} className="rounded-full border bg-background px-3 py-1 text-xs">{s}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border bg-accent p-4 text-sm text-muted-foreground">Loading…</div>
            )}

            <div className="flex gap-2 sticky bottom-0 bg-card pt-2 mt-auto sm:relative sm:pt-0 sm:mt-0">
              <button
                type="button"
                className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border bg-card px-4 text-sm font-medium text-foreground hover:bg-accent"
                onClick={() => setStep("profile")}
              >
                Back
              </button>
              <button
                type="button"
                className="inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
                onClick={() => {
                  if (onClose) onClose()
                  router.push(returnTo || "/dashboard")
                }}
              >
                Go to dashboard
              </button>
            </div>
          </div>
        ) : (
          <ReviewStep
            job={job as Job}
            candidate={candidate}
            coverLetter={coverLetter}
            setCoverLetter={setCoverLetter}
            busy={busy}
            onBack={() => setStep("profile")}
            onSubmit={submit}
          />
        )
      ) : null}

      {needsResume && step === "review" ? <div className="text-xs text-muted-foreground">Upload a resume before submitting.</div> : null}
      {requiredMissing && step === "review" ? <div className="text-xs text-muted-foreground">Complete required profile fields before submitting.</div> : null}
    </div>
  )
}
