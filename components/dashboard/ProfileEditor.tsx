"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { Candidate, ParsingJob } from "@/lib/types"
import { bearerHeaders, invalidateSessionCache } from "@/lib/http"
import { useRouter } from "next/navigation"
import { mapToTags, tagsToMap } from "@/components/apply/tagUtils"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card"
import { Input, Textarea } from "@/components/ui/Input"
import { Spinner } from "@/components/ui/Spinner"

function isValidPhone(value: unknown) {
  const input = typeof value === "string" ? value.trim() : ""
  if (!input) return true
  const digits = input.replace(/\D+/g, "")
  if (digits.length === 10) return true
  if (digits.length === 12 && digits.startsWith("91")) return true
  if (input.startsWith("+") && digits.length >= 10 && digits.length <= 15) return true
  return false
}

export function ProfileEditor({
  accessToken,
  candidate,
  onCandidateUpdated
}: {
  accessToken: string
  candidate: Candidate
  onCandidateUpdated: (c: Candidate) => void
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(candidate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsingJob, setParsingJob] = useState<ParsingJob | null>(null)
  const [origin, setOrigin] = useState("")

  const preferences = useMemo(() => tagsToMap(draft.tags), [draft.tags])

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const refreshCandidate = useCallback(async () => {
    try {
      const res = await fetch("/api/candidate/profile", { headers: bearerHeaders(accessToken) })
      const data = await res.json()
      if (res.ok && data?.candidate) {
        onCandidateUpdated(data.candidate)
        setDraft(data.candidate)
      }
    } catch {
    }
  }, [accessToken, onCandidateUpdated])

  useEffect(() => {
    if (!accessToken || !parsingJob?.id) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (stopped) return
      try {
        const res = await fetch(`/api/candidate/resume/status?parsing_job_id=${parsingJob.id}`, {
          headers: bearerHeaders(accessToken)
        })
        const data = await res.json()
        if (res.ok && data?.parsingJob) {
          const next = data.parsingJob as ParsingJob
          setParsingJob(next)
          if (next.status === "completed" || next.status === "failed") {
            invalidateSessionCache("boardapp:candidateProfile:", { prefix: true })
            invalidateSessionCache("boardapp:jobsSearch:", { prefix: true })
            await refreshCandidate()
            return
          }
        }
      } catch {
      }
      timer = setTimeout(poll, 2000)
    }

    poll()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [accessToken, parsingJob?.id, refreshCandidate])

  const publicUrl = draft.public_profile_enabled && draft.public_profile_slug ? `${origin}/talent/${draft.public_profile_slug}` : null

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/candidate/profile", {
        method: "PUT",
        headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: draft.name,
          phone: draft.phone,
          current_role: draft.current_role,
          total_experience: draft.total_experience,
          location: draft.location,
          preferred_location: draft.preferred_location,
          desired_role: draft.desired_role,
          summary: draft.summary,
          linkedin_profile: draft.linkedin_profile,
          portfolio_url: draft.portfolio_url,
          github_profile: draft.github_profile,
          public_profile_enabled: draft.public_profile_enabled,
          public_profile_slug: draft.public_profile_slug,
          tags: draft.tags
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save")
      onCandidateUpdated(data.candidate)
      setDraft(data.candidate)
      invalidateSessionCache("boardapp:candidateProfile:", { prefix: true })
      invalidateSessionCache("boardapp:jobsSearch:", { prefix: true })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const uploadResume = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("resume", file)
      const res = await fetch("/api/candidate/resume/parse", {
        method: "POST",
        headers: bearerHeaders(accessToken),
        body: fd
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to upload")
      if (data.parsingJob) setParsingJob(data.parsingJob)
      if (data.candidate) {
        onCandidateUpdated(data.candidate)
        setDraft(data.candidate)
      }
      invalidateSessionCache("boardapp:candidateProfile:", { prefix: true })
      invalidateSessionCache("boardapp:jobsSearch:", { prefix: true })
      router.push(`/onboarding?returnTo=${encodeURIComponent("/dashboard")}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your profile</CardTitle>
        <CardDescription>Keep it updated to one‑tap apply faster.</CardDescription>
      </CardHeader>
      <CardBody className="grid gap-4">
        {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</div> : null}

        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">Email</div>
          <Input value={draft.email} disabled />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Full name *</div>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Phone</div>
            <Input value={draft.phone || ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            {draft.phone && !isValidPhone(draft.phone) ? (
              <div className="text-xs text-muted-foreground">Use 10 digits or +91XXXXXXXXXX.</div>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Current role *</div>
            <Input value={draft.current_role} onChange={(e) => setDraft({ ...draft, current_role: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Total experience *</div>
            <Input value={draft.total_experience} onChange={(e) => setDraft({ ...draft, total_experience: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Location *</div>
            <Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">LinkedIn</div>
            <Input value={draft.linkedin_profile || ""} onChange={(e) => setDraft({ ...draft, linkedin_profile: e.target.value })} placeholder="https://" />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Portfolio</div>
            <Input value={draft.portfolio_url || ""} onChange={(e) => setDraft({ ...draft, portfolio_url: e.target.value })} placeholder="https://" />
          </div>
        </div>

        <div className="rounded-3xl border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">Public profile</div>
              <div className="mt-1 text-xs text-muted-foreground">Enable a shareable talent profile link.</div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(draft.public_profile_enabled)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    public_profile_enabled: e.target.checked,
                    public_profile_slug: e.target.checked ? draft.public_profile_slug || "" : null
                  })
                }
              />
              <span>Public</span>
            </label>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Profile URL slug</div>
              <Input
                value={draft.public_profile_slug || ""}
                onChange={(e) => setDraft({ ...draft, public_profile_slug: e.target.value })}
                disabled={!draft.public_profile_enabled}
                placeholder="your-name"
              />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Share link</div>
              <div className="h-11 truncate rounded-xl border bg-background px-3 py-2 text-sm text-muted-foreground">
                {publicUrl || "Enable public profile to generate link"}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Industry</div>
            <Input
              value={preferences.industry || ""}
              onChange={(e) => {
                const next = { ...preferences, industry: e.target.value }
                setDraft({ ...draft, tags: mapToTags(next) })
              }}
            />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Open for a job</div>
            <select
              value={preferences.open_for_job || "yes"}
              onChange={(e) => {
                const next = { ...preferences, open_for_job: e.target.value }
                setDraft({ ...draft, tags: mapToTags(next) })
              }}
              className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">Summary</div>
          <Textarea value={draft.summary || ""} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
        </div>

        <div className="rounded-3xl border bg-accent p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Resume</div>
              <div className="mt-1 text-xs text-muted-foreground">Upload a new resume to re‑autofill.</div>
            </div>
            <label className={busy ? "pointer-events-none inline-flex cursor-pointer opacity-70" : "inline-flex cursor-pointer"}>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) uploadResume(f)
                  e.currentTarget.value = ""
                }}
                className="hidden"
              />
              <span className="rounded-full border bg-card px-4 py-2 text-sm hover:bg-accent">{busy ? "Uploading…" : "Upload"}</span>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {draft.file_name ? <Badge>{draft.file_name}</Badge> : <Badge>No resume uploaded</Badge>}
            {parsingJob?.status ? <Badge>Parsing: {parsingJob.status}</Badge> : null}
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : null}
            Save changes
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
