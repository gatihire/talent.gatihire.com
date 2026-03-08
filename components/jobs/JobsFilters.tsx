"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"

type Filters = { q: string; role: string; skills: string[]; location: string; jobType: string }

const ROLE_OPTIONS = [
  "Transportation",
  "Warehousing",
  "Fleet operations",
  "Dispatch",
  "Supply chain",
  "Last-mile",
  "Brokerage",
  "Safety & Compliance",
  "Customer support",
  "Other"
]

const SKILL_OPTIONS = [
  "TMS",
  "Dispatch",
  "Fleet ops",
  "Load planning",
  "Route optimization",
  "Warehouse ops",
  "Inventory",
  "Excel",
  "Customer support",
  "DOT compliance",
  "Safety",
  "Cold chain",
  "3PL",
  "Last-mile"
]

function buildQuery(filters: Filters) {
  const sp = new URLSearchParams()
  if (filters.q.trim()) sp.set("q", filters.q.trim())
  if (filters.role) sp.set("role", filters.role)
  if (filters.skills.length) sp.set("skills", filters.skills.join(","))
  if (filters.location.trim()) sp.set("location", filters.location.trim())
  if (filters.jobType) sp.set("jobType", filters.jobType)
  return sp.toString()
}

export function JobsFilters({ initial }: { initial: Filters }) {
  const router = useRouter()

  const [q, setQ] = useState(initial.q)
  const [roleOpen, setRoleOpen] = useState(false)
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [role, setRole] = useState(initial.role)
  const [skills, setSkills] = useState<string[]>(initial.skills)

  const skillsLabel = useMemo(() => {
    if (!skills.length) return "Skills"
    if (skills.length === 1) return skills[0]
    return `${skills[0]} +${skills.length - 1}`
  }, [skills])

  const [lastApplied, setLastApplied] = useState<string | null>(null)

  const hasFilters = Boolean(q.trim() || role || skills.length)

  const apply = () => {
    const next = buildQuery({ ...initial, q, role, skills })
    router.push(next ? `/jobs?${next}` : "/jobs")
    setLastApplied(next)
    setRoleOpen(false)
    setSkillsOpen(false)
  }

  const clear = () => {
    setQ("")
    setRole("")
    setSkills([])
    router.push("/jobs")
    setRoleOpen(false)
    setSkillsOpen(false)
    setLastApplied(null)
  }

  const isSearchStale = lastApplied !== buildQuery({ ...initial, q, role, skills })

  const toggleSkill = (s: string) => {
    setSkills((prev) => {
      const set = new Set(prev)
      if (set.has(s)) set.delete(s)
      else set.add(s)
      return Array.from(set)
    })
  }

  return (
    <div className="rounded-3xl border bg-card p-5 relative">
      <div className="grid gap-3 md:grid-cols-12">
        <div className="md:col-span-4 relative group">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search jobs"
            className="h-11 w-full rounded-xl border border-input bg-background px-4 pr-8 text-sm focus:ring-2 focus:ring-primary/20 transition-all"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="relative md:col-span-2">
          <button
            type="button"
            onClick={() => {
              setRoleOpen((v) => !v)
              setSkillsOpen(false)
            }}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 pr-8 text-left text-sm relative"
          >
            <span className="truncate block">{role || "Role"}</span>
            {role && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setRole("")
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </button>

          {roleOpen ? (
            <div className="absolute left-0 right-0 top-12 z-50 rounded-2xl border bg-card p-4 shadow-xl">
              <div className="flex flex-wrap gap-2">
                {ROLE_OPTIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(role === r ? "" : r)}
                    className={[
                      "rounded-full border px-3 py-1.5 text-xs",
                      role === r ? "bg-accent border-primary/30" : "bg-background hover:bg-accent"
                    ].join(" ")}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setRole("")}
                >
                  Clear
                </button>
                <button type="button" className="rounded-full border bg-card px-4 py-2 text-sm hover:bg-accent font-medium" onClick={apply}>
                  Apply
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="relative md:col-span-3">
          <button
            type="button"
            onClick={() => {
              setSkillsOpen((v) => !v)
              setRoleOpen(false)
            }}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 pr-8 text-left text-sm relative"
          >
            <span className="truncate block">{skillsLabel}</span>
            {skills.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setSkills([])
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </button>

          {skillsOpen ? (
            <div className="absolute left-0 right-0 top-12 z-50 rounded-2xl border bg-card p-4 shadow-xl">
              <div className="flex flex-wrap gap-2">
                {SKILL_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSkill(s)}
                    className={[
                      "rounded-full border px-3 py-1.5 text-xs",
                      skills.includes(s) ? "bg-accent border-primary/30" : "bg-background hover:bg-accent"
                    ].join(" ")}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSkills([])}>
                  Clear
                </button>
                <button type="button" className="rounded-full border bg-card px-4 py-2 text-sm hover:bg-accent font-medium" onClick={apply}>
                  Apply
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="md:col-span-3 flex items-center justify-end gap-2">
          {hasFilters && (
            <button type="button" className="text-sm text-muted-foreground hover:text-foreground mr-2" onClick={clear}>
              Reset
            </button>
          )}
          <button
            type="button"
            className={[
              "rounded-full border px-6 py-2 text-sm font-medium transition-all shadow-sm",
              isSearchStale ? "bg-primary text-primary-foreground hover:bg-primary/90 scale-105" : "bg-card hover:bg-accent"
            ].join(" ")}
            onClick={apply}
          >
            {isSearchStale ? "Search again" : "Apply filters"}
          </button>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
        <div className="h-1 w-1 rounded-full bg-gray-300" />
        Role • Skills • Location • Commitment • Job type
      </div>
    </div>
  )
}

