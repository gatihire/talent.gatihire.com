"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Bell, Briefcase, ChevronLeft, ChevronRight, LayoutGrid, LogOut, User } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useSupabaseSession } from "@/lib/useSupabaseSession"
import { bearerHeaders } from "@/lib/http"
import { WorkAvailabilityModal } from "@/components/dashboard/WorkAvailabilityModal"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { BRAND_LOGO_URL, BRAND_NAME } from "@/lib/branding"

type NavItem = { label: string; href: string; active: (p: string) => boolean; comingSoon?: boolean }

const SIDEBAR_COLLAPSED_KEY = "truckinzy:dashboardSidebarCollapsed"

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() || ""
  const { session } = useSupabaseSession()
  const accessToken = session?.access_token

  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [availabilityOpen, setAvailabilityOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      const v = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
      if (v === null) return false
      return v === "1"
    } catch {
      return false
    }
  })
  const [candidateName, setCandidateName] = useState<string>("")
  const [candidateProfile, setCandidateProfile] = useState<any | null | undefined>(undefined)
  const [notifications, setNotifications] = useState<any[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifBusy, setNotifBusy] = useState(false)

  const nav = useMemo<NavItem[]>(
    () => [
      { label: "Jobs", href: "/dashboard/jobs", active: (p) => p === "/dashboard" || p === "/dashboard/jobs" || p.startsWith("/dashboard/jobs/") },
      { label: "My work", href: "/dashboard/my-work?tab=invites", active: (p) => p.startsWith("/dashboard/my-work") },
      { label: "Profile", href: "/dashboard/profile", active: (p) => p.startsWith("/dashboard/profile") },
      { label: "Career help", href: "#", active: () => false, comingSoon: true },
      { label: "Wallet", href: "#", active: () => false, comingSoon: true },
      { label: "Refer and earn", href: "#", active: () => false, comingSoon: true }
    ],
    []
  )

  useEffect(() => {
    if (!accessToken) {
      setCandidateName("")
      setCandidateProfile(undefined)
      return
    }
    let active = true
    fetch("/api/candidate/profile?details=0", { headers: bearerHeaders(accessToken) })
      .then(async (r) => {
        const data = await r.json().catch(() => null)
        if (!active) return
        if (!r.ok) return
        const name = typeof data?.candidate?.name === "string" ? data.candidate.name : ""
        setCandidateName(name)
        setCandidateProfile(data?.candidate || null)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [accessToken])

  useEffect(() => {
    if (!accessToken) return
    if (candidateProfile === undefined) return

    const hasResume = Boolean((candidateProfile as any)?.file_url)
    const requiredReady = Boolean((candidateProfile as any)?.name) && Boolean((candidateProfile as any)?.current_role) && Boolean((candidateProfile as any)?.total_experience) && Boolean((candidateProfile as any)?.location)

    if (!hasResume || !requiredReady) {
      const current = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : pathname
      router.replace(`/onboarding?returnTo=${encodeURIComponent(current)}`)
    }
  }, [accessToken, candidateProfile, pathname, router])

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0")
    } catch {}
  }, [collapsed])

  const avatarUrl = useMemo(() => {
    const meta = (session?.user?.user_metadata as any) || {}
    const url = meta.avatar_url || meta.picture || meta.avatar
    return typeof url === "string" ? url : ""
  }, [session?.user?.user_metadata])

  const displayName = useMemo(() => {
    const meta = (session?.user?.user_metadata as any) || {}
    const name = meta.full_name || meta.name
    if (typeof name === "string" && name.trim()) return name.trim()
    if (candidateName.trim()) return candidateName.trim()
    return ""
  }, [candidateName, session?.user?.user_metadata])

  const initials = useMemo(() => {
    const src = displayName || "User"
    const words = src.replace(/[._-]+/g, " ").split(" ").filter(Boolean)
    const a = (words[0]?.[0] || "U").toUpperCase()
    const b = (words[1]?.[0] || "").toUpperCase()
    return `${a}${b}`.slice(0, 2)
  }, [displayName])

  const loadNotifications = useCallback(async () => {
    if (!accessToken) return
    setNotifBusy(true)
    try {
      const res = await fetch("/api/candidate/notifications", { headers: bearerHeaders(accessToken) })
      const data = await res.json().catch(() => null)
      if (!res.ok) return
      setNotifications(Array.isArray(data?.notifications) ? data.notifications : [])
      setUnreadCount(Number(data?.unreadCount || 0) || 0)
    } finally {
      setNotifBusy(false)
    }
  }, [accessToken])

  useEffect(() => {
    if (!accessToken) return
    loadNotifications()
  }, [accessToken, loadNotifications])

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-app pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="flex h-16 w-full items-center gap-3 px-6">
          <Link href="/dashboard/jobs" className="flex items-center gap-2">
            <div className="h-8 w-28 overflow-hidden">
              <img 
                src={BRAND_LOGO_URL} 
                alt={BRAND_NAME} 
                className="h-full w-full object-contain dark:invert transition-all duration-300" 
              />
            </div>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <button
                className="relative h-10 w-10 rounded-full border border-border/60 bg-card/60 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                onClick={() => {
                  setNotifOpen((v) => !v)
                  setMenuOpen(false)
                  if (!notifOpen) loadNotifications()
                }}
                aria-label="Notifications"
              >
                <Bell className="mx-auto h-4 w-4" />
                {unreadCount > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </button>

              {notifOpen ? (
                <div className="absolute right-0 top-12 w-[340px] rounded-2xl border border-border/60 bg-popover p-2 shadow-lg shadow-black/10 dark:shadow-black/40">
                  <div className="flex items-center justify-between px-2 py-1">
                    <div className="text-sm font-semibold">Notifications</div>
                    <button
                      className="rounded-xl px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={async () => {
                        if (!accessToken) return
                        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
                        setUnreadCount(0)
                        await fetch("/api/candidate/notifications", {
                          method: "POST",
                          headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
                          body: JSON.stringify({ action: "mark_all_read" })
                        })
                        await loadNotifications()
                      }}
                    >
                      Mark all read
                    </button>
                  </div>

                  <div className="mt-1 max-h-[360px] overflow-auto">
                    {notifBusy ? (
                      <div className="px-3 py-6 text-sm text-muted-foreground">Loading…</div>
                    ) : notifications.length ? (
                      <div className="grid gap-1">
                        {notifications.map((n: any) => {
                          const type = String(n?.type || "")
                          const payload = (n?.payload || {}) as any

                          let title = "Update"
                          if (type === "welcome") title = `Welcome to ${BRAND_NAME}`
                          else if (type === "profile_updated") title = "Profile updated"
                          else if (type === "application_submitted") title = "Application submitted"
                          else if (type === "application_status_changed") title = "Application status updated"
                          else if (type === "new_job_match") title = "New job match"
                          else if (type === "new_job_published") title = "New job posted"

                          let description = ""
                          if (typeof payload?.message === "string" && payload.message.trim()) {
                            description = payload.message.trim()
                          } else if (Array.isArray(payload?.changed) && payload.changed.length) {
                            description = `Updated: ${payload.changed.slice(0, 3).join(", ")}${payload.changed.length > 3 ? "…" : ""}`
                          } else if (type === "application_submitted" || type === "application_status_changed") {
                            const jobTitle = String(payload?.job_title || payload?.jobTitle || "").trim()
                            const status = String(payload?.status || payload?.application_status || "").trim()
                            if (jobTitle && status) {
                              description = `Your application for ${jobTitle} is now ${status}.`
                            } else if (jobTitle) {
                              description = `Your application for ${jobTitle} has an update.`
                            } else {
                              description = "Your application has an update."
                            }
                          } else if (type === "new_job_match" || type === "new_job_published") {
                            const jobTitle = String(payload?.job_title || payload?.jobTitle || "").trim()
                            if (jobTitle) {
                              description = `New role: ${jobTitle}`
                            } else {
                              description = "You have a new job opportunity."
                            }
                          } else if (type === "welcome") {
                            description = "Set up your profile and start applying to jobs."
                          } else {
                            description = "You have a new update."
                          }

                          const applicationId =
                            String(payload?.applicationId || payload?.application_id || "").trim() || null
                          const jobId = String(payload?.jobId || payload?.job_id || "").trim() || null

                          let target = "/dashboard/profile"
                          if (type === "application_submitted" || type === "application_status_changed") {
                            if (applicationId) {
                              target = `/dashboard/my-work?tab=applications&applicationId=${encodeURIComponent(applicationId)}`
                            } else if (jobId) {
                              target = `/dashboard/my-work?tab=applications&jobId=${encodeURIComponent(jobId)}`
                            } else {
                              target = "/dashboard/my-work?tab=applications"
                            }
                          } else if (type === "new_job_match" || type === "new_job_published") {
                            if (jobId) {
                              target = `/dashboard/jobs?highlightJobId=${encodeURIComponent(jobId)}`
                            } else {
                              target = "/dashboard/jobs"
                            }
                          }

                          return (
                            <button
                              key={String(n.id)}
                              className={[
                                "w-full rounded-xl px-3 py-2 text-left hover:bg-accent/60",
                                n.is_read ? "" : "bg-primary/10"
                              ].join(" ")}
                              onClick={async () => {
                                if (!accessToken) return
                                setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)))
                                setUnreadCount((c) => Math.max(0, c - (n.is_read ? 0 : 1)))
                                await fetch("/api/candidate/notifications", {
                                  method: "POST",
                                  headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
                                  body: JSON.stringify({ action: "mark_read", id: n.id })
                                })
                                setNotifOpen(false)
                                router.push(target)
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium">{title}</div>
                                  <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
                                </div>
                                {!n.is_read ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="px-3 py-6 text-sm text-muted-foreground">No notifications yet.</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <ThemeToggle />

            <button
              className="relative h-10 w-10 rounded-full border border-border/60 bg-card/60 text-sm font-semibold"
              onClick={() => {
                setMenuOpen((v) => !v)
                setNotifOpen(false)
              }}
              aria-label="Open menu"
            >
              {avatarUrl ? <img className="h-full w-full rounded-full object-cover" alt={displayName || "Avatar"} src={avatarUrl} /> : initials}
            </button>

            {menuOpen ? (
              <div className="absolute right-4 top-16 w-56 rounded-2xl border border-border/60 bg-popover p-2 shadow-lg shadow-black/10 dark:shadow-black/40">
                <Link
                  className="block rounded-xl px-3 py-2 text-sm hover:bg-accent/60"
                  href="/dashboard/profile"
                  onClick={() => setMenuOpen(false)}
                >
                  Profile
                </Link>
                <button
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-accent/60"
                  onClick={() => {
                    setMenuOpen(false)
                    setAvailabilityOpen(true)
                  }}
                >
                  Work availability
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-accent/60"
                  onClick={async () => {
                    setMenuOpen(false)
                    await signOut()
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex w-full">
        <aside
          className={[
            "relative hidden md:block shrink-0 border-r border-border/60 bg-panel",
            collapsed ? "w-[72px]" : "w-[240px]"
          ].join(" ")}
        >
          <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-auto p-3">
            <div className={collapsed ? "flex justify-center" : "flex items-center justify-between"}>
              <div className={["text-xs font-medium text-muted-foreground", collapsed ? "sr-only" : ""].join(" ")}>Navigation</div>
              <button
                className="rounded-xl border border-border/60 bg-card/60 p-2 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                onClick={() => setCollapsed((v) => !v)}
                aria-label="Toggle sidebar"
              >
                {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </button>
            </div>

            <nav className="mt-3 grid gap-1">
              {nav.map((item) => {
                const active = item.active(pathname)
                const disabled = item.comingSoon
                const icon =
                  item.label === "Jobs" ? (
                    <Briefcase className="h-4 w-4" />
                  ) : item.label === "My work" ? (
                    <LayoutGrid className="h-4 w-4" />
                  ) : item.label === "Profile" ? (
                    <User className="h-4 w-4" />
                  ) : (
                    <User className="h-4 w-4" />
                  )
                return (
                  <a
                    key={item.label}
                    href={disabled ? "#" : item.href}
                    className={[
                      "flex items-center justify-between rounded-xl px-3 py-2 text-sm",
                      active ? "bg-accent/60" : "hover:bg-accent/60",
                      disabled ? "cursor-not-allowed opacity-60" : ""
                    ].join(" ")}
                  >
                    <span className="flex items-center gap-3">
                      {icon}
                      <span className={collapsed ? "sr-only" : ""}>{item.label}</span>
                    </span>
                    {item.comingSoon && !collapsed ? <span className="rounded-full border bg-background px-2 py-0.5 text-[10px]">Soon</span> : null}
                  </a>
                )
              })}
            </nav>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>

      <WorkAvailabilityModal open={availabilityOpen} onClose={() => setAvailabilityOpen(false)} />

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 md:hidden">
        <div className="flex w-full items-center justify-around px-2 py-2">
          <Link
            href="/dashboard/jobs"
            className={[
              "flex flex-col items-center gap-1 rounded-2xl px-4 py-2 text-xs",
              pathname === "/dashboard" || pathname.startsWith("/dashboard/jobs") ? "bg-accent/60" : ""
            ].join(" ")}
          >
            <Briefcase className="h-5 w-5" />
            Jobs
          </Link>
          <Link
            href="/dashboard/my-work?tab=invites"
            className={[
              "flex flex-col items-center gap-1 rounded-2xl px-4 py-2 text-xs",
              pathname.startsWith("/dashboard/my-work") ? "bg-accent/60" : ""
            ].join(" ")}
          >
            <LayoutGrid className="h-5 w-5" />
            My work
          </Link>
          <Link
            href="/dashboard/profile"
            className={[
              "flex flex-col items-center gap-1 rounded-2xl px-4 py-2 text-xs",
              pathname.startsWith("/dashboard/profile") ? "bg-accent/60" : ""
            ].join(" ")}
          >
            <User className="h-5 w-5" />
            Profile
          </Link>
        </div>
      </nav>
    </div>
  )
}
