"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import Link from "next/link"
import type { Job, JobSection } from "@/lib/types"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import { JobApplyForm } from "@/components/jobs/JobApplyForm"
import { useSupabaseSession } from "@/lib/useSupabaseSession"
import { AuthModal } from "@/components/auth/AuthModal"
import { Briefcase, CalendarDays, Clock, Flame, Globe2, GraduationCap, MapPin, ShieldCheck, Users, Wallet } from "lucide-react"

type ClientLite = {
  name: string
  slug: string | null
  logo_url: string | null
  website?: string | null
  company_type?: string | null
  location?: string | null
  open_jobs_count?: number
}

function normalizeSectionBody(body: string) {
  const lines = String(body || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)

  const bullets: string[] = []
  const paragraphs: string[] = []

  for (const line of lines) {
    if (/^[-•\u2022]\s+/.test(line)) {
      bullets.push(line.replace(/^[-•\u2022]\s+/, "").trim())
    } else {
      paragraphs.push(line)
    }
  }

  return { bullets, paragraphs }
}

function formatEnum(value: string | null | undefined) {
  const v = String(value || "")
  if (!v) return ""
  return v
    .replace(/_/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
}

export function JobApplyPageClient({
  job,
  client,
  sections,
  backHref = "/jobs",
}: {
  job: Job & { client_id?: string | null; client_name?: string | null }
  client: ClientLite | null
  sections: JobSection[]
  backHref?: string
}) {
  const { session } = useSupabaseSession()
  const applyRef = useRef<HTMLDivElement | null>(null)
  const clientName = client?.name || job.client_name || "Client"

  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<"login" | "signup">("login")

  const openAuth = useCallback((mode: "login" | "signup") => {
    setAuthMode(mode)
    setAuthOpen(true)
  }, [])

  const visibleSections = useMemo(() => {
    const rows = Array.isArray(sections) ? sections : []
    return rows.filter((s) => s && s.is_visible !== false && String(s.body_md || "").trim().length)
  }, [sections])

  const headerBadges = useMemo(() => {
    const items: string[] = []
    if (job.city || job.location) items.push(String(job.city || job.location || ""))
    if (job.employment_type) items.push(formatEnum(job.employment_type))
    if (job.industry) items.push(job.industry)
    return items
  }, [job])

  const highlights = useMemo(() => {
    const items: Array<{ icon: any; label: string; value: string }> = []
    const locationValue = String(job.city || job.location || "")
    if (locationValue) items.push({ icon: MapPin, label: "Location", value: locationValue })

    const salary =
      job.salary_min || job.salary_max
        ? `INR ${String(job.salary_min || "").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${job.salary_max ? ` - ${String(job.salary_max).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}` : ""} / ${formatEnum(job.salary_type)}`
        : ""
    if (salary) items.push({ icon: Wallet, label: "Salary", value: salary })

    if (job.shift_type) items.push({ icon: Clock, label: "Shift", value: formatEnum(job.shift_type) })
    if (job.urgency_tag) items.push({ icon: Flame, label: "Urgency", value: formatEnum(job.urgency_tag) })
    if (typeof job.openings === "number" && job.openings > 0) items.push({ icon: Users, label: "Openings", value: String(job.openings) })
    return items.slice(0, 5)
  }, [job])

  const requirementRows = useMemo(() => {
    const rows: Array<{ icon: any; label: string; value: string }> = []
    const expRange =
      job.experience_min_years || job.experience_max_years
        ? `${job.experience_min_years || 0} - ${job.experience_max_years || 0} years`
        : ""
    if (expRange) rows.push({ icon: Briefcase, label: "Experience", value: expRange })
    if (job.education_min) rows.push({ icon: GraduationCap, label: "Education", value: formatEnum(job.education_min) })
    if (job.english_level) rows.push({ icon: Globe2, label: "English level", value: formatEnum(job.english_level) })
    if (job.age_min || job.age_max) rows.push({ icon: CalendarDays, label: "Age limit", value: `${job.age_min || ""}${job.age_max ? ` - ${job.age_max}` : ""}`.trim() })
    if (job.gender_preference) rows.push({ icon: Users, label: "Gender", value: formatEnum(job.gender_preference) })
    if (job.license_type) rows.push({ icon: ShieldCheck, label: "License", value: formatEnum(job.license_type) })
    return rows
  }, [job])

  const aboutRoleBody = useMemo(() => {
    const about = visibleSections.find((s) => s.section_key === "about_role")
    if (about) return about.body_md

    let desc = String(job.description || "").trim()
    const hasGemini = visibleSections.some((s) => s.section_key === "job_description")
    // If we have Gemini JD, strip the old raw JD from description if present
    if (hasGemini && desc.includes("---")) {
      desc = desc.split("---")[0].trim()
    }
    return desc
  }, [visibleSections, job.description])

  return (
    <div className="pb-24">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={backHref} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to jobs
        </Link>
        <div className="flex items-center gap-2">
          {client?.slug ? (
            <Link href={`/clients/${client.slug}`} className="text-sm text-muted-foreground hover:text-foreground">
              View {clientName}
            </Link>
          ) : null}
        </div>
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} defaultMode={authMode} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="rounded-3xl border bg-card p-7">
            <div className="flex flex-wrap items-center gap-3">
              {client?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={clientName} src={client.logo_url} className="h-10 w-10 rounded-2xl border bg-background object-cover" />
              ) : (
                <div className="h-10 w-10 rounded-2xl border bg-background" />
              )}
              <div>
                {client?.slug ? (
                  <Link href={`/clients/${client.slug}`} className="text-sm font-medium hover:underline hover:underline-offset-4">
                    {clientName}
                  </Link>
                ) : (
                  <div className="text-sm font-medium">{clientName}</div>
                )}
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {headerBadges.map((b) => (
                    <Badge key={b}>{b}</Badge>
                  ))}
                </div>
              </div>
            </div>

            <h1 className="mt-5 text-2xl font-semibold sm:text-3xl">{job.title}</h1>
            {job.created_at ? (
              <div className="mt-2 text-sm text-muted-foreground">Posted {new Date(job.created_at).toLocaleDateString()}</div>
            ) : null}
          </div>

          <div className="mt-7 grid gap-6">
            {highlights.length ? (
              <section className="rounded-3xl border bg-card p-6">
                <h2 className="text-sm font-semibold">At a glance</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {highlights.map((h) => {
                    const Icon = h.icon
                    return (
                      <div key={h.label} className="flex items-start gap-3 rounded-2xl border bg-background p-4">
                        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl border bg-card">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">{h.label}</div>
                          <div className="mt-1 text-sm font-medium leading-snug">{h.value}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {requirementRows.length ? (
              <section className="rounded-3xl border bg-card p-6">
                <h2 className="text-sm font-semibold">Job requirements</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {requirementRows.map((row) => {
                    const Icon = row.icon
                    return (
                      <div key={row.label} className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl border bg-background">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">{row.label}</div>
                          <div className="mt-1 text-sm font-medium leading-snug">{row.value}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {aboutRoleBody ? (
              <section className="rounded-3xl border bg-card p-6">
                <h2 className="text-sm font-semibold">About the role</h2>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{aboutRoleBody}</div>
              </section>
            ) : null}

            {visibleSections.length ? (
              <div className="grid gap-6">
                {visibleSections
                  .filter((s) => s.section_key !== "about_role")
                  .map((s) => {
                    const content = normalizeSectionBody(s.body_md)
                    return (
                      <section key={s.section_key} className="rounded-3xl border bg-card p-6">
                        <h2 className="text-sm font-semibold">{s.heading}</h2>
                        {content.paragraphs.length ? (
                          <div className="mt-3 grid gap-3 text-sm leading-relaxed text-muted-foreground">
                            {content.paragraphs.map((p, idx) => (
                              <p key={idx} className="whitespace-pre-wrap">
                                {p}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        {content.bullets.length ? (
                          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
                            {content.bullets.map((b, idx) => (
                              <li key={idx} className="flex gap-3">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/50" />
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </section>
                    )
                  })}
              </div>
            ) : null}

            {Array.isArray((job as any).skills_must_have) && (job as any).skills_must_have.length ? (
              <section className="rounded-3xl border bg-card p-6">
                <h2 className="text-sm font-semibold">Must-have skills</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {((job as any).skills_must_have as string[]).map((s) => (
                    <span key={s} className="rounded-full border bg-accent px-3 py-1.5 text-xs">{s}</span>
                  ))}
                </div>
              </section>
            ) : null}

            {Array.isArray((job as any).skills_good_to_have) && (job as any).skills_good_to_have.length ? (
              <section className="rounded-3xl border bg-card p-6">
                <h2 className="text-sm font-semibold">Good-to-have skills</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {((job as any).skills_good_to_have as string[]).map((s) => (
                    <span key={s} className="rounded-full border bg-background px-3 py-1.5 text-xs">{s}</span>
                  ))}
                </div>
              </section>
            ) : null}

            <div ref={applyRef} id="apply" className="scroll-mt-24 lg:hidden">
              <JobApplyForm job={job} />
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="hidden lg:block lg:sticky lg:top-24">
            <div className="grid gap-4">
              <div className="rounded-3xl border bg-card p-7">
                <JobApplyForm job={job} />
              </div>

              <div className="rounded-3xl border bg-card p-7">
                <div className="text-sm font-semibold">More about {clientName}</div>
                <div className="mt-4 flex items-center gap-3">
                  {client?.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={clientName} src={client.logo_url} className="h-10 w-10 rounded-2xl border bg-background object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-2xl border bg-background" />
                  )}
                  {client?.slug ? (
                    <a href={`/clients/${client.slug}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline hover:underline-offset-4">
                      {clientName}
                    </a>
                  ) : (
                    <div className="text-sm font-medium">{clientName}</div>
                  )}
                </div>

                <div className="mt-4 grid gap-2 text-sm text-muted-foreground">
                  {client?.website ? (
                    <a className="hover:text-foreground hover:underline hover:underline-offset-4" href={client.website} target="_blank" rel="noopener noreferrer">
                      {client.website}
                    </a>
                  ) : null}
                  {client?.company_type ? <div>{client.company_type}</div> : null}
                  {client?.location ? <div>{client.location}</div> : null}
                  {typeof client?.open_jobs_count === "number" && client?.slug ? (
                    <a href={`/clients/${client.slug}`} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline hover:underline-offset-4">
                      {client.open_jobs_count} open jobs
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/85 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{job.title}</div>
            <div className="truncate text-xs text-muted-foreground">{clientName}</div>
          </div>
          <Button onClick={() => applyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>Apply</Button>
        </div>
      </div>
    </div>
  )
}
