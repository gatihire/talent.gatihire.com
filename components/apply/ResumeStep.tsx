"use client"

import type { Candidate, ParsingJob } from "@/lib/types"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Card, CardBody } from "@/components/ui/Card"
import { Spinner } from "@/components/ui/Spinner"

export function ResumeStep({
  candidate,
  candidateLoading,
  busy,
  parsingJob,
  onError,
  onUploadAndParse,
  onParseExisting,
  onSkip
}: {
  candidate: Candidate | null
  candidateLoading: boolean
  busy: boolean
  parsingJob: ParsingJob | null
  onError: (msg: string | null) => void
  onUploadAndParse: (file: File) => Promise<void>
  onParseExisting: () => Promise<void>
  onSkip: () => void
}) {
  const needsResume = !candidate?.file_url

  return (
    <Card>
      <CardBody className="pt-6">
        <div className="grid gap-4">
          <div>
            <div className="text-base font-semibold">Resume upload</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {needsResume ? "Upload your resume to autofill profile fields." : "Resume found. You can replace it anytime."}
            </div>
          </div>

          {candidateLoading ? (
            <div className="text-sm text-muted-foreground">Loading profile…</div>
          ) : candidate ? (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge>{candidate.email}</Badge>
              {candidate.file_name ? <Badge>{candidate.file_name}</Badge> : null}
            </div>
          ) : null}

          <label
            className={[
              "group relative grid cursor-pointer place-items-center rounded-3xl border border-dashed bg-background px-6 py-10 text-center transition",
              busy ? "opacity-80" : "hover:bg-accent"
            ].join(" ")}
          >
            <div className="grid gap-2">
              <div className="text-sm font-semibold">{needsResume ? "Upload your resume" : "Replace resume"}</div>
              <div className="text-xs text-muted-foreground">PDF, DOC, DOCX or TXT (max 10MB recommended)</div>
              {candidate?.file_name ? <div className="text-xs text-muted-foreground">Current: {candidate.file_name}</div> : null}
            </div>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0] || null
                if (!f) return
                onError(null)
                try {
                  await onUploadAndParse(f)
                } finally {
                  e.target.value = ""
                }
              }}
              className="sr-only"
            />
          </label>

          <div className="flex gap-2 sticky bottom-0 bg-card pt-2 mt-auto sm:relative sm:pt-0 sm:mt-0">
            {!needsResume ? (
              <>
                <Button variant="secondary" onClick={onParseExisting} disabled={busy} className="flex-1 h-12 rounded-xl">
                  Parse existing
                </Button>
                <Button variant="secondary" onClick={onSkip} disabled={busy} className="flex-1 h-12 rounded-xl">
                  Skip
                </Button>
              </>
            ) : null}
          </div>

          {busy ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner /> Uploading…
            </div>
          ) : null}

          {parsingJob ? <div className="text-xs text-muted-foreground">Parsing status: {parsingJob.status || "pending"}</div> : null}
        </div>
      </CardBody>
    </Card>
  )
}
