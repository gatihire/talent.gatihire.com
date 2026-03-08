"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { Job } from "@/lib/types"
import { useSupabaseSession } from "@/lib/useSupabaseSession"
import { bearerHeaders } from "@/lib/http"
import { Button } from "@/components/ui/Button"
import { Card, CardBody } from "@/components/ui/Card"
import { Modal } from "@/components/ui/Modal"
import { Spinner } from "@/components/ui/Spinner"
import { ApplyStepper } from "@/components/ApplyStepper"
import { supabase } from "@/lib/supabase"
import { FileUp, Sparkles, UserRoundCheck } from "lucide-react"

export function JobApplyForm({ job }: { job: Job }) {
  const { session, loading } = useSupabaseSession()
  const accessToken = session?.access_token
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const inviteToken = (sp.get("invite") || "").trim()
  const returnTo = `/jobs/${job.id}?apply=1${inviteToken ? `&invite=${encodeURIComponent(inviteToken)}` : ""}`

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applicationId, setApplicationId] = useState<string | null>(null)

  const [authMode, setAuthMode] = useState<"login" | "signup">("signup")

  const isExternal = String((job as any).apply_type || "in_platform") === "external"
  const externalUrl = String((job as any).external_apply_url || "").trim()

  useEffect(() => {
    const shouldOpen = sp.get("apply") === "1"
    if (shouldOpen) {
      setOpen(true)
      const next = new URLSearchParams(sp.toString())
      next.delete("apply")
      router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false })
    }
  }, [pathname, router, sp])

  useEffect(() => {
    if (!accessToken) {
      setApplicationId(null)
      return
    }
    let active = true
    fetch(`/api/candidate/applications?jobId=${encodeURIComponent(job.id)}`, { headers: bearerHeaders(accessToken) })
      .then(async (r) => {
        const data = await r.json().catch(() => null)
        if (!active) return
        if (!r.ok) return
        const row = Array.isArray(data?.applications) ? data.applications[0] : null
        setApplicationId(row?.id ? String(row.id) : null)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [accessToken, job.id])

  const continueExternal = async () => {
    if (!accessToken) return
    if (!externalUrl) {
      setError("This job does not have a company apply link yet.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/candidate/external-apply", {
        method: "POST",
        headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ jobId: job.id, redirectUrl: externalUrl, referrer: document.referrer || null })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Failed to continue")
      window.open(externalUrl, "_blank", "noopener,noreferrer")
      setOpen(false)
    } catch (e: any) {
      setError(e.message || "Failed to continue")
    } finally {
      setBusy(false)
    }
  }

  const ctaLabel = isExternal
    ? "Apply on company site"
    : applicationId
      ? "Applied"
      : session
        ? "Apply"
        : "Upload your CV to apply"

  return (
    <Card>
      <CardBody className="pt-6">
        <div className="grid gap-3">
          {applicationId ? (
            <div className="grid gap-2">
              <Button variant="secondary" onClick={() => router.push(`/dashboard/my-work?tab=applications&applicationId=${encodeURIComponent(applicationId)}`)} className="w-full h-12">
                View status
              </Button>
              <div className="text-xs text-muted-foreground">You already applied for this job.</div>
            </div>
          ) : (
            <Button onClick={() => setOpen(true)} className="w-full h-12">
            {loading ? <Spinner /> : null}
            {ctaLabel}
            </Button>
          )}
          {!session ? <div className="text-xs text-muted-foreground">Takes less than 2 minutes — resume autofill + one‑tap apply.</div> : null}
        </div>

        <Modal open={open} onClose={() => setOpen(false)} size="lg" title={isExternal ? `Apply on company site — ${job.title}` : `Apply — ${job.title}`}>
          {error ? <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">{error}</div> : null}
          {isExternal ? (
            session ? (
              <div className="grid gap-4">
                <div className="rounded-2xl border bg-accent p-4 text-sm text-muted-foreground">
                  You’ll be redirected to the company’s official job page to complete your application.
                </div>
                <Button onClick={continueExternal} disabled={busy} className="h-12">
                  {busy ? <Spinner /> : null}
                  Continue to company site
                </Button>
              </div>
            ) : (
              <ExternalApplyAuthPanel jobId={job.id} mode={authMode} onModeChange={setAuthMode} returnTo={returnTo} />
            )
          ) : applicationId ? (
            <div className="grid gap-4">
              <div className="rounded-2xl border bg-accent p-4 text-sm text-muted-foreground">You already applied for this job.</div>
              <Button
                variant="secondary"
                onClick={() => router.push(`/dashboard/my-work?tab=applications&applicationId=${encodeURIComponent(applicationId)}`)}
                className="h-12"
              >
                View status
              </Button>
            </div>
          ) : (
            <ApplyStepper job={job} returnTo={returnTo} />
          )}
        </Modal>
      </CardBody>
    </Card>
  )
}

function ExternalApplyAuthPanel({
  jobId,
  mode,
  onModeChange,
  returnTo,
}: {
  jobId: string
  mode: "login" | "signup"
  onModeChange: (mode: "login" | "signup") => void
  returnTo: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const GoogleLogo = (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.2 1.54 7.62 2.84l5.18-5.18C33.67 4.19 29.33 2 24 2 14.64 2 6.54 7.39 2.69 15.2l6.73 5.22C11.33 14.11 17.16 9.5 24 9.5Z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.54-.14-3.02-.4-4.45H24v8.43h12.63c-.54 2.9-2.18 5.35-4.64 7l7.1 5.5C43.59 36.77 46.5 31.16 46.5 24.5Z"
      />
      <path
        fill="#FBBC05"
        d="M9.42 28.42c-.48-1.42-.76-2.93-.76-4.42 0-1.5.28-3 .76-4.42l-6.73-5.22C1.15 17.09.5 20.49.5 24c0 3.51.65 6.91 2.19 9.64l6.73-5.22Z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.33 0 9.81-1.76 13.08-4.79l-7.1-5.5c-1.96 1.32-4.46 2.1-5.98 2.1-6.84 0-12.67-4.61-14.58-10.92l-6.73 5.22C6.54 40.61 14.64 46 24 46Z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  )

  const continueWithGoogle = async () => {
    setBusy(true)
    setError(null)
    try {
      const origin = window.location.origin
      const redirectTo = `${origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`
      const { error: err } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } })
      if (err) {
        setError(err.message)
        setBusy(false)
      }
    } catch (e: any) {
      setError(String(e?.message || "Failed to start Google sign-in"))
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div className="text-center">
        <div className="text-lg font-semibold">{mode === "login" ? "Sign in to continue" : "Create your profile"}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {mode === "login" ? "Continue with Google in one step." : "Upload your resume and we’ll build your profile for you."}
        </div>
      </div>

      {mode === "signup" ? (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border bg-card p-3">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-xs font-medium">
            <span className="h-5 w-5 rounded-full bg-accent text-center leading-5">G</span>
            Google
          </div>
          <div className="text-muted-foreground">→</div>
          <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-xs font-medium">
            <FileUp className="h-4 w-4" />
            Upload resume
          </div>
          <div className="text-muted-foreground">→</div>
          <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-xs font-medium">
            <Sparkles className="h-4 w-4" />
            We autofill
          </div>
          <div className="text-muted-foreground">→</div>
          <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-xs font-medium">
            <UserRoundCheck className="h-4 w-4" />
            Review & apply
          </div>
        </div>
      ) : null}

      {error ? <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">{error}</div> : null}

      <Button
        variant="secondary"
        onClick={continueWithGoogle}
        disabled={busy}
        className="h-12 w-full rounded-2xl border border-border bg-white text-zinc-900 hover:bg-zinc-50"
      >
        {busy ? <Spinner /> : GoogleLogo}
        {mode === "login" ? "Continue with Google" : "Create profile with Google"}
      </Button>

      <div className="text-center text-sm text-muted-foreground">
        {mode === "login" ? (
          <button type="button" className="text-foreground underline underline-offset-4" onClick={() => onModeChange("signup")}>
            New here? Create profile
          </button>
        ) : (
          <button type="button" className="text-foreground underline underline-offset-4" onClick={() => onModeChange("login")}>
            Already have a profile? Sign in
          </button>
        )}
      </div>
    </div>
  )
}
