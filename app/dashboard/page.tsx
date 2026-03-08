"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Spinner } from "@/components/ui/Spinner"
import { useSupabaseSession } from "@/lib/useSupabaseSession"
import { bearerHeaders } from "@/lib/http"
import type { Candidate } from "@/lib/types"
import { Bell, Briefcase, Sparkles, User } from "lucide-react"

type NotificationRow = {
  id: string
  type?: string | null
  payload?: any
  is_read?: boolean | null
}

function computeProfileProgress(candidate: Candidate | null) {
  if (!candidate) return { pct: 0, missing: [] as string[] }
  const missing: string[] = []
  const has = (v: unknown) => Boolean(String(v || "").trim())
  if (!has(candidate.name)) missing.push("Name")
  if (!has(candidate.email)) missing.push("Email")
  if (!has(candidate.phone)) missing.push("Phone")
  if (!has(candidate.location)) missing.push("Location")
  if (!has(candidate.current_role)) missing.push("Current role")
  if (!has(candidate.total_experience)) missing.push("Experience")
  if (!has((candidate as any)?.summary)) missing.push("Bio")
  if (!has((candidate as any)?.file_url)) missing.push("Resume")
  const total = 8
  const done = total - missing.length
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)))
  return { pct, missing }
}

function resolveNotificationTarget(n: NotificationRow) {
  const type = String(n?.type || "")
  const payload = (n?.payload || {}) as any
  const applicationId = String(payload?.applicationId || payload?.application_id || "").trim() || null
  const jobId = String(payload?.jobId || payload?.job_id || "").trim() || null

  if (type === "application_submitted" || type === "application_status_changed") {
    if (applicationId) return `/dashboard/my-work?tab=applications&applicationId=${encodeURIComponent(applicationId)}`
    if (jobId) return `/dashboard/my-work?tab=applications&jobId=${encodeURIComponent(jobId)}`
    return "/dashboard/my-work?tab=applications"
  }
  if (type === "new_job_match" || type === "new_job_published") {
    if (jobId) return `/dashboard/jobs?highlightJobId=${encodeURIComponent(jobId)}`
    return "/dashboard/jobs"
  }
  return "/dashboard/profile"
}

function resolveNotificationTitle(n: NotificationRow) {
  const type = String(n?.type || "")
  if (type === "welcome") return "Welcome to GatiHire"
  if (type === "profile_updated") return "Profile updated"
  if (type === "application_submitted") return "Application submitted"
  if (type === "application_status_changed") return "Application status updated"
  if (type === "new_job_match") return "New job match"
  if (type === "new_job_published") return "New job posted"
  return "Update"
}

function resolveNotificationDescription(n: NotificationRow) {
  const type = String(n?.type || "")
  const payload = (n?.payload || {}) as any
  if (typeof payload?.message === "string" && payload.message.trim()) return payload.message.trim()

  if (type === "application_submitted" || type === "application_status_changed") {
    const jobTitle = String(payload?.job_title || payload?.jobTitle || "").trim()
    const status = String(payload?.status || payload?.application_status || "").trim()
    if (jobTitle && status) return `Your application for ${jobTitle} is now ${status}.`
    if (jobTitle) return `Your application for ${jobTitle} has an update.`
    return "Your application has an update."
  }

  if (type === "new_job_match" || type === "new_job_published") {
    const jobTitle = String(payload?.job_title || payload?.jobTitle || "").trim()
    return jobTitle ? `New role: ${jobTitle}` : "You have a new job opportunity."
  }

  if (type === "welcome") return "Set up your profile and start applying to jobs."
  return "You have a new update."
}

export default function DashboardPage() {
  const router = useRouter()
  const { session, loading: sessionLoading } = useSupabaseSession()
  const accessToken = session?.access_token

  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [notif, setNotif] = useState<NotificationRow[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!accessToken) {
      setCandidate(null)
      setNotif([])
      return
    }
    let active = true
    setBusy(true)
    Promise.all([
      fetch("/api/candidate/profile", { headers: bearerHeaders(accessToken) }).then((r) => r.json().catch(() => null)),
      fetch("/api/candidate/notifications", { headers: bearerHeaders(accessToken) }).then((r) => r.json().catch(() => null))
    ])
      .then(([p, n]) => {
        if (!active) return
        setCandidate((p?.candidate || null) as Candidate | null)
        setNotif(Array.isArray(n?.notifications) ? (n.notifications as NotificationRow[]) : [])
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [accessToken])

  const progress = useMemo(() => computeProfileProgress(candidate), [candidate])
  const recentNotif = useMemo(() => notif.slice(0, 5), [notif])

  if (!accessToken) {
    return (
      <Card>
        <CardBody className="py-10 text-sm text-muted-foreground">{sessionLoading ? <Spinner /> : "Please log in."}</CardBody>
      </Card>
    )
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Shortcuts to keep your job search moving.</CardDescription>
          </CardHeader>
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Link href="/dashboard/jobs" className="block">
              <div className="group rounded-2xl border border-border/60 bg-card/60 p-4 hover:bg-accent/60 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <Briefcase className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">Browse jobs</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">Search roles and apply faster</div>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/dashboard/profile" className="block">
              <div className="group rounded-2xl border border-border/60 bg-card/60 p-4 hover:bg-accent/60 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <User className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">Update profile</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">Improve matching and visibility</div>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/jobs" className="block">
              <div className="group rounded-2xl border border-border/60 bg-card/60 p-4 hover:bg-accent/60 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">Public jobs</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">See what’s trending right now</div>
                  </div>
                </div>
              </div>
            </Link>

            <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Bell className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Notifications</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">Open the bell in the header</div>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile strength</CardTitle>
            <CardDescription>Higher completion improves recommendations.</CardDescription>
          </CardHeader>
          <CardBody>
            <div className="flex items-end justify-between gap-3">
              <div className="text-3xl font-semibold">{busy ? "…" : `${progress.pct}%`}</div>
              <Link href="/dashboard/profile">
                <Button variant="secondary" size="sm">Improve</Button>
              </Link>
            </div>
            <div className="mt-4 h-2 w-full rounded-full bg-muted/60 overflow-hidden">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress.pct}%` }} />
            </div>
            {progress.missing.length ? (
              <div className="mt-3 text-xs text-muted-foreground">Missing: {progress.missing.slice(0, 4).join(", ")}{progress.missing.length > 4 ? "…" : ""}</div>
            ) : (
              <div className="mt-3 text-xs text-muted-foreground">You’re all set.</div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Your latest notifications and updates.</CardDescription>
        </CardHeader>
        <CardBody>
          {busy ? (
            <div className="py-6 text-sm text-muted-foreground"><Spinner /></div>
          ) : recentNotif.length ? (
            <div className="grid gap-2">
              {recentNotif.map((n) => {
                const title = resolveNotificationTitle(n)
                const desc = resolveNotificationDescription(n)
                const target = resolveNotificationTarget(n)
                return (
                  <button
                    key={String(n.id)}
                    className={[
                      "w-full rounded-2xl border border-border/60 bg-card/60 px-4 py-3 text-left hover:bg-accent/60 transition-colors",
                      n.is_read ? "" : "ring-1 ring-primary/20"
                    ].join(" ")}
                    onClick={() => router.push(target)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
                      </div>
                      {!n.is_read ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="py-6 text-sm text-muted-foreground">No activity yet.</div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
