"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import type { Application, Job } from "@/lib/types"
import { useSupabaseSession } from "@/lib/useSupabaseSession"
import { bearerHeaders } from "@/lib/http"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Spinner } from "@/components/ui/Spinner"

type InviteRow = {
  id: string
  status: string | null
  token: string | null
  sent_at: string | null
  opened_at: string | null
  responded_at: string | null
  applied_at: string | null
  rejected_at: string | null
  created_at: string | null
  jobs?: Pick<Job, "id" | "title" | "location" | "industry" | "sub_category" | "employment_type" | "client_name">
}

type ApplicationRow = Application & { jobs?: Pick<Job, "id" | "title" | "location" | "client_name"> }

type Tab = "invites" | "applications"

export function MyWork() {
  const { session, loading } = useSupabaseSession()
  const accessToken = session?.access_token
  const search = useSearchParams()
  const router = useRouter()

  const tab = useMemo<Tab>(() => {
    const t = (search.get("tab") || "invites").toLowerCase()
    return t === "applications" ? "applications" : "invites"
  }, [search])

  const focusApplicationId = useMemo(() => {
    const v = search.get("applicationId")
    return v ? v.trim() : ""
  }, [search])

  const query = useMemo(() => (search.get("q") || "").trim(), [search])
  const page = useMemo(() => Math.max(1, Number(search.get("page") || "1") || 1), [search])

  const [busy, setBusy] = useState(false)
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [applications, setApplications] = useState<ApplicationRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const [draftQ, setDraftQ] = useState("")
  const [qFocused, setQFocused] = useState(false)

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(search.toString())
    params.set("tab", next)
    params.delete("applicationId")
    params.set("page", "1")
    router.push(`/dashboard/my-work?${params.toString()}`)
  }

  const applySearch = (override?: string) => {
    const next = new URLSearchParams(search.toString())
    const v = typeof override === "string" ? override.trim() : draftQ.trim()
    if (v) next.set("q", v)
    else next.delete("q")
    next.set("page", "1")
    router.push(`/dashboard/my-work?${next.toString()}`)
  }

  useEffect(() => {
    setDraftQ(query)
  }, [query])

  useEffect(() => {
    if (!focusApplicationId) return
    if (tab !== "applications") {
      const params = new URLSearchParams(search.toString())
      params.set("tab", "applications")
      router.replace(`/dashboard/my-work?${params.toString()}`)
    }
  }, [focusApplicationId, router, search, tab])

  useEffect(() => {
    if (loading) return
    if (!accessToken) return

    let active = true
    setBusy(true)
    setError(null)

    const load = async () => {
      try {
        const [invRes, appRes] = await Promise.all([
          fetch("/api/candidate/invites", { headers: bearerHeaders(accessToken) }),
          fetch("/api/candidate/applications", { headers: bearerHeaders(accessToken) })
        ])

        const inv = await invRes.json().catch(() => null)
        const app = await appRes.json().catch(() => null)
        if (!active) return

        if (invRes.ok) setInvites(inv?.invites || [])
        else setInvites([])

        if (appRes.ok) setApplications(app?.applications || [])
        else setApplications([])

        const errs: string[] = []
        if (!invRes.ok) errs.push(inv?.error || "Failed to load invites")
        if (!appRes.ok) errs.push(app?.error || "Failed to load applications")
        setError(errs.length ? errs.join(" • ") : null)
      } catch (e: any) {
        if (!active) return
        setError(e?.message || "Failed to load")
      } finally {
        if (!active) return
        setBusy(false)
      }
    }

    load()

    return () => {
      active = false
    }
  }, [accessToken, loading])

  useEffect(() => {
    if (!focusApplicationId) return
    if (busy) return
    if (tab !== "applications") return
    const el = document.getElementById(`application-${focusApplicationId}`)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [busy, focusApplicationId, tab])

  const pageSize = 15

  const filteredInvites = useMemo(() => {
    if (!query) return invites
    const q = query.toLowerCase()
    return invites.filter((row) => {
      const title = String(row.jobs?.title || "").toLowerCase()
      const loc = String(row.jobs?.location || "").toLowerCase()
      return title.includes(q) || loc.includes(q)
    })
  }, [invites, query])

  const filteredApplications = useMemo(() => {
    if (!query) return applications
    const q = query.toLowerCase()
    return applications.filter((row) => {
      const title = String(row.jobs?.title || row.job_id || "").toLowerCase()
      const loc = String(row.jobs?.location || "").toLowerCase()
      return title.includes(q) || loc.includes(q)
    })
  }, [applications, query])

  const list = tab === "invites" ? filteredInvites : filteredApplications
  const total = list.length
  const start = (page - 1) * pageSize
  const end = start + pageSize
  const pageItems = list.slice(start, end)
  const hasMore = end < total

  const suggestionPool = useMemo(() => {
    const src = tab === "invites" ? invites.map((r) => r.jobs?.title).filter(Boolean) : applications.map((r) => r.jobs?.title || r.job_id)
    return Array.from(new Set(src.map((x) => String(x || "").trim()).filter(Boolean))).slice(0, 200)
  }, [applications, invites, tab])

  const qSuggestions = useMemo(() => {
    const q = draftQ.trim().toLowerCase()
    if (!q || q.length < 2) return [] as string[]
    return suggestionPool.filter((x) => x.toLowerCase().includes(q)).slice(0, 8)
  }, [draftQ, suggestionPool])

  if (!accessToken) {
    return (
      <div className="rounded-3xl border bg-card p-8">
        {loading ? (
          <Spinner />
        ) : (
          <div className="grid gap-3">
            <div className="text-sm font-semibold">Sign in to view My Work</div>
            <div className="text-sm text-muted-foreground">Track applications and invites in one place.</div>
            <Link href="/jobs?login=1">
              <Button className="h-11 rounded-xl">Continue to Jobs</Button>
            </Link>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-3xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold">My Work</div>
            <div className="mt-1 text-sm text-muted-foreground">Your invites and applications, organized.</div>
          </div>
          <Link href="/dashboard/jobs">
            <Button variant="secondary" className="h-11 rounded-xl">Browse jobs</Button>
          </Link>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative">
            <Input
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              onFocus={() => setQFocused(true)}
              onBlur={() => window.setTimeout(() => setQFocused(false), 120)}
              placeholder="Search by job title or location"
              className="h-12 rounded-2xl bg-background"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  applySearch()
                }
              }}
            />
            {qFocused && qSuggestions.length ? (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border bg-background shadow-lg">
                {qSuggestions.map((opt) => (
                  <button
                    key={`mwq:${opt}`}
                    type="button"
                    onClick={() => {
                      setDraftQ(opt)
                      applySearch(opt)
                    }}
                    className="block w-full px-4 py-3 text-left text-sm hover:bg-accent"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Button className="h-12 rounded-2xl" onClick={() => applySearch()}>
            Search
          </Button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-b pb-3">
          <button
            onClick={() => setTab("invites")}
            className={[
              "rounded-full border px-4 py-2 text-sm font-medium",
              tab === "invites" ? "bg-accent text-foreground" : "bg-background text-muted-foreground hover:bg-accent"
            ].join(" ")}
          >
            Invites <span className="ml-1 text-xs text-muted-foreground">({invites.length})</span>
          </button>
          <button
            onClick={() => setTab("applications")}
            className={[
              "rounded-full border px-4 py-2 text-sm font-medium",
              tab === "applications" ? "bg-accent text-foreground" : "bg-background text-muted-foreground hover:bg-accent"
            ].join(" ")}
          >
            Applications <span className="ml-1 text-xs text-muted-foreground">({applications.length})</span>
          </button>

          <div className="ml-auto text-xs text-muted-foreground">
            Showing {Math.min(total, start + 1)}–{Math.min(total, end)} of {total}
          </div>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">{error}</div> : null}

      {busy ? (
        <div className="rounded-3xl border bg-card p-8">
          <Spinner />
        </div>
      ) : tab === "invites" ? (
        <div className="rounded-3xl border bg-card p-6">
          {!pageItems.length ? (
            <div className="mx-auto max-w-sm text-center">
              <div className="mx-auto mb-4 h-10 w-10 rounded-full bg-warning/20" />
              <div className="text-lg font-semibold">No invites yet</div>
              <div className="mt-2 text-sm text-muted-foreground">When you receive invites, they’ll show up here.</div>
            </div>
          ) : (
            <div className="grid gap-3">
              {(pageItems as InviteRow[]).map((row) => (
                <div key={row.id} className="rounded-3xl border bg-background p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold">{row.jobs?.title || "Invite"}</div>
                      {row.jobs?.client_name ? <div className="mt-0.5 text-sm text-muted-foreground">{row.jobs.client_name}</div> : null}
                      <div className="mt-1 text-sm text-muted-foreground">
                        {row.jobs?.location || "Remote"} {row.jobs?.industry ? `• ${row.jobs.industry}` : ""}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border bg-card px-3 py-1.5">{row.status || "sent"}</span>
                        {row.opened_at ? <span>Opened</span> : <span>Not opened</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {row.jobs?.id ? (
                        <Link className="rounded-full border bg-background px-4 py-2 text-sm hover:bg-accent" href={`/jobs/${row.jobs.id}`}>
                          View job
                        </Link>
                      ) : null}
                      {row.status !== "rejected" ? (
                        <button
                          className="rounded-full border bg-background px-4 py-2 text-sm hover:bg-accent"
                          onClick={async () => {
                            setBusy(true)
                            setError(null)
                            try {
                              const res = await fetch("/api/candidate/invites", {
                                method: "POST",
                                headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
                                body: JSON.stringify({ inviteId: row.id, action: "reject" })
                              })
                              const data = await res.json().catch(() => null)
                              if (!res.ok) throw new Error(data?.error || "Failed")
                              setInvites((prev) => prev.map((x) => (x.id === row.id ? { ...x, status: "rejected" } : x)))
                            } catch (e: any) {
                              setError(e.message || "Failed")
                            } finally {
                              setBusy(false)
                            }
                          }}
                        >
                          Reject
                        </button>
                      ) : null}
                      {row.token ? (
                        <Link className="rounded-full border bg-card px-4 py-2 text-sm hover:bg-accent" href={`/invite/${row.token}`}>
                          Accept & apply
                        </Link>
                      ) : row.jobs?.id ? (
                        <Link className="rounded-full border bg-card px-4 py-2 text-sm hover:bg-accent" href={`/jobs/${row.jobs.id}/apply`}>
                          Apply
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-3xl border bg-card p-6">
          {!pageItems.length ? (
            <div className="text-sm text-muted-foreground">No applications yet.</div>
          ) : (
            <div className="grid gap-3">
              {(pageItems as ApplicationRow[]).map((row) => (
                <div
                  key={row.id}
                  id={`application-${row.id}`}
                  className={[
                    "rounded-3xl border bg-background p-5",
                    focusApplicationId && row.id === focusApplicationId ? "border-primary/40 bg-primary/5" : ""
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold">{row.jobs?.title || row.job_id}</div>
                      {row.jobs?.client_name ? <div className="mt-0.5 text-sm text-muted-foreground">{row.jobs.client_name}</div> : null}
                      <div className="mt-1 text-sm text-muted-foreground">
                        {row.applied_at ? new Date(row.applied_at).toLocaleDateString() : ""}
                        {row.jobs?.location ? ` • ${row.jobs.location}` : ""}
                      </div>
                    </div>
                    <div className="rounded-full border bg-card px-3 py-1.5 text-xs">{row.status || "applied"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-center gap-2 py-2">
        <Button
          variant="secondary"
          className="rounded-xl"
          disabled={page <= 1}
          onClick={() => {
            const params = new URLSearchParams(search.toString())
            params.set("page", String(Math.max(1, page - 1)))
            router.push(`/dashboard/my-work?${params.toString()}`)
          }}
        >
          Prev
        </Button>
        <div className="text-sm text-muted-foreground">Page {page}</div>
        <Button
          variant="secondary"
          className="rounded-xl"
          disabled={!hasMore}
          onClick={() => {
            const params = new URLSearchParams(search.toString())
            params.set("page", String(page + 1))
            router.push(`/dashboard/my-work?${params.toString()}`)
          }}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
