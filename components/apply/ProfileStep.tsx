"use client"

import type { Candidate } from "@/lib/types"
import { mapToTags, tagsToMap } from "@/components/apply/tagUtils"
import { Button } from "@/components/ui/Button"
import { Card, CardBody } from "@/components/ui/Card"
import { Input, Textarea } from "@/components/ui/Input"
import { Spinner } from "@/components/ui/Spinner"

function isValidEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim() : ""
  if (!email) return false
  return /^\S+@\S+\.\S+$/.test(email)
}

function isValidPhone(value: unknown) {
  const input = typeof value === "string" ? value.trim() : ""
  if (!input) return false
  const digits = input.replace(/\D+/g, "")
  if (digits.length === 10) return true
  if (digits.length === 12 && digits.startsWith("91")) return true
  if (input.startsWith("+") && digits.length >= 10 && digits.length <= 15) return true
  return false
}

export function ProfileStep({
  candidate,
  setCandidate,
  busy,
  onBack,
  onContinue
}: {
  candidate: Candidate | null
  setCandidate: (next: Candidate) => void
  busy: boolean
  onBack: () => void
  onContinue: () => void
}) {
  const preferences = tagsToMap(candidate?.tags)

  if (!candidate) {
    return (
      <Card>
        <CardBody className="pt-6">
          <div className="text-sm text-muted-foreground">Loading profile…</div>
        </CardBody>
      </Card>
    )
  }

  const missingName = !String(candidate.name || "").trim()
  const missingEmail = !isValidEmail(candidate.email)
  const missingPhone = !isValidPhone(candidate.phone)
  const isFresher = preferences.fresher === "yes"
  const missingExpectedSalary = !String(candidate.expected_salary || "").trim()
  const missingCurrentSalary = !isFresher && !String(candidate.current_salary || "").trim()
  
  const disableContinue = busy || missingName || missingEmail || missingPhone || missingExpectedSalary || missingCurrentSalary

  return (
    <Card>
      <CardBody className="pt-6">
        <div className="grid gap-6">
          <div>
            <div className="text-base font-semibold">Autofill & review</div>
            <div className="mt-1 text-sm text-muted-foreground">Confirm your contact details.</div>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Full name *</div>
              <Input value={candidate.name || ""} onChange={(e) => setCandidate({ ...candidate, name: e.target.value })} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <div className="text-xs font-medium text-muted-foreground">Email *</div>
                <Input value={candidate.email || ""} onChange={(e) => setCandidate({ ...candidate, email: e.target.value })} />
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-medium text-muted-foreground">Phone *</div>
                <Input value={candidate.phone || ""} onChange={(e) => setCandidate({ ...candidate, phone: e.target.value })} />
                {candidate.phone && !isValidPhone(candidate.phone) ? (
                  <div className="text-xs text-muted-foreground">Use 10 digits or +91XXXXXXXXXX.</div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="border-t pt-6">
            <div>
              <div className="text-base font-semibold">Work availability</div>
              <div className="mt-1 text-sm text-muted-foreground">Set your job search preferences.</div>
            </div>

            <div className="mt-4 grid gap-4">
              <div className="flex items-center justify-between gap-3 rounded-2xl border bg-accent/30 p-4">
                <div className="text-sm font-medium text-foreground">Open to work</div>
                <input
                  type="checkbox"
                  checked={candidate.looking_for_work !== false}
                  onChange={(e) => setCandidate({ ...candidate, looking_for_work: e.target.checked })}
                  className="h-5 w-5 rounded border-input bg-card text-primary focus:ring-ring/20"
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl border bg-accent/30 p-4">
                <div className="text-sm font-medium text-foreground">Are you a fresher?</div>
                <input
                  type="checkbox"
                  checked={isFresher}
                  onChange={(e) => {
                    const next = { ...preferences, fresher: e.target.checked ? "yes" : "no" }
                    setCandidate({ ...candidate, tags: mapToTags(next) })
                  }}
                  className="h-5 w-5 rounded border-input bg-card text-primary focus:ring-ring/20"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {!isFresher && (
                  <div className="grid gap-2">
                    <div className="text-xs font-medium text-muted-foreground">Current CTC (Monthly) *</div>
                    <Input
                      value={candidate.current_salary || ""}
                      onChange={(e) => setCandidate({ ...candidate, current_salary: e.target.value })}
                      placeholder="e.g. ₹25,000"
                    />
                  </div>
                )}
                <div className="grid gap-2">
                  <div className="text-xs font-medium text-muted-foreground">Expected CTC (Monthly) *</div>
                  <Input
                    value={candidate.expected_salary || ""}
                    onChange={(e) => setCandidate({ ...candidate, expected_salary: e.target.value })}
                    placeholder="e.g. ₹35,000"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2 sticky bottom-0 bg-card pt-2 mt-auto sm:relative sm:pt-0 sm:mt-0">
            <Button variant="secondary" onClick={onBack} disabled={busy} className="flex-1 h-12 rounded-xl">
              Back
            </Button>
            <Button onClick={onContinue} disabled={disableContinue} className="flex-1 h-12 rounded-xl shadow-lg shadow-primary/20">
              {busy ? <Spinner /> : null}
              Continue
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
