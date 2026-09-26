"use client"

import { useMemo } from "react"
import type { Candidate, Job } from "@/lib/types"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Card, CardBody } from "@/components/ui/Card"
import { Textarea, Input } from "@/components/ui/Input"
import { Spinner } from "@/components/ui/Spinner"

export function ReviewStep({
  job,
  candidate,
  coverLetter,
  setCoverLetter,
  currentCtc,
  setCurrentCtc,
  expectedCtc,
  setExpectedCtc,
  noticePeriod,
  setNoticePeriod,
  reasonForSwitching,
  setReasonForSwitching,
  busy,
  onBack,
  onSubmit
}: {
  job: Job
  candidate: Candidate | null
  coverLetter: string
  setCoverLetter: (v: string) => void
  currentCtc: string
  setCurrentCtc: (v: string) => void
  expectedCtc: string
  setExpectedCtc: (v: string) => void
  noticePeriod: string
  setNoticePeriod: (v: string) => void
  reasonForSwitching: string
  setReasonForSwitching: (v: string) => void
  busy: boolean
  onBack: () => void
  onSubmit: () => void
}) {
  const needsResume = !candidate?.file_url
  const requiredMissing = !candidate?.current_role || !candidate?.location || !candidate?.total_experience || !candidate?.name
  const missingNotice = !noticePeriod.trim()

  const disabledReason = useMemo(() => {
    if (!candidate) return "Profile not loaded"
    if (needsResume) return "Upload a resume before submitting"
    if (requiredMissing) return "Complete required profile fields"
    if (missingNotice) return "Enter your notice period"
    return null
  }, [candidate, needsResume, requiredMissing, missingNotice])

  return (
    <Card>
      <CardBody className="pt-6">
        <div className="grid gap-4">
          <div>
            <div className="text-base font-semibold">One‑tap apply</div>
            <div className="mt-1 text-sm text-muted-foreground">Review and submit in a single action.</div>
          </div>

          <div className="grid gap-2 rounded-2xl border bg-accent p-4">
            <div className="text-sm font-medium">{job.title}</div>
            <div className="flex flex-wrap gap-2 text-xs">
              {job.location ? <Badge>{job.location}</Badge> : null}
              {job.industry ? <Badge>{job.industry}</Badge> : null}
              {job.employment_type ? <Badge>{String(job.employment_type).replace(/_/g, " ")}</Badge> : null}
            </div>
          </div>

          {candidate ? (
            <div className="grid gap-2 rounded-2xl border bg-accent p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">{candidate.name}</div>
                <div className="text-xs text-muted-foreground">{candidate.email}</div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge>{candidate.current_role}</Badge>
                <Badge>{candidate.location}</Badge>
                <Badge>{candidate.total_experience}</Badge>
                {candidate.file_name ? <Badge>{candidate.file_name}</Badge> : null}
              </div>
            </div>
          ) : null}

          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Cover letter (optional)</div>
            <Textarea value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} placeholder="Add a note for the recruiter" />
          </div>

          <div className="grid gap-3 rounded-2xl border bg-accent p-4">
            <div>
              <div className="text-sm font-medium">Compensation & availability</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Helps us shortlist and schedule your screening call faster.</div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Current CTC</label>
                <Input value={currentCtc} onChange={(e) => setCurrentCtc(e.target.value)} placeholder="e.g. 8 LPA" className="h-12" />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Expected CTC</label>
                <Input value={expectedCtc} onChange={(e) => setExpectedCtc(e.target.value)} placeholder="e.g. 12 LPA" className="h-12" />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Notice period *</label>
                <Input
                  value={noticePeriod}
                  onChange={(e) => setNoticePeriod(e.target.value)}
                  placeholder="e.g. 30 days / immediate"
                  className="h-12"
                  aria-required="true"
                />
                {!noticePeriod.trim() ? (
                  <div className="text-xs text-muted-foreground">Required to shortlist.</div>
                ) : null}
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Reason for switching (optional)</label>
              <Textarea
                value={reasonForSwitching}
                onChange={(e) => setReasonForSwitching(e.target.value)}
                placeholder="e.g. Better growth, closer to home, higher package…"
                rows={2}
              />
            </div>
          </div>

          <div className="flex gap-2 sticky bottom-0 bg-card pt-2 mt-auto sm:relative sm:pt-0 sm:mt-0">
            <Button variant="secondary" onClick={onBack} disabled={busy} className="flex-1 h-12 rounded-xl">
              Back
            </Button>
            <Button onClick={onSubmit} disabled={busy || !!disabledReason} className="flex-1 h-12 rounded-xl shadow-lg shadow-primary/20">
              {busy ? <Spinner /> : null}
              Submit application
            </Button>
          </div>

          {disabledReason ? <div className="text-xs text-muted-foreground">{disabledReason}</div> : null}
        </div>
      </CardBody>
    </Card>
  )
}
