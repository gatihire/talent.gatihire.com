"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { Candidate, Job } from "@/lib/types"
import { supabase } from "@/lib/supabase"
import { useSupabaseSession } from "@/lib/useSupabaseSession"
import { bearerHeaders, cachedFetchJson, invalidateSessionCache } from "@/lib/http"
import { AuthModal } from "@/components/auth/AuthModal"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Card, CardBody } from "@/components/ui/Card"
import { Input } from "@/components/ui/Input"
import { Modal } from "@/components/ui/Modal"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { BRAND_LOGO_URL, BRAND_NAME } from "@/lib/branding"
import { ArrowRight, Briefcase, Building2, Filter, LayoutGrid, List, MapPin, Search, SlidersHorizontal } from "lucide-react"
import {
  BOARD_LOCATION_PRESETS,
  MIGRATION_ALL_SUGGESTIONS,
  MIGRATION_SKILLS,
  MIGRATION_TOP_JOB_TITLES,
  MIGRATION_TOP_SKILLS,
  getSuggestionMatches,
} from "@/lib/search-suggestions"

type ClientLite = { id: string; name: string; slug: string | null; logo_url: string | null }

const LOCATION_PRESETS = BOARD_LOCATION_PRESETS
const SKILL_SUGGESTIONS = MIGRATION_SKILLS

function tagsToMap(tags: unknown) {
  const out: Record<string, string> = {}
  const arr = Array.isArray(tags) ? (tags as unknown[]) : []
  for (const t of arr) {
    if (typeof t !== "string") continue
    const [k, ...rest] = t.split(":")
    if (!k || rest.length === 0) continue
    out[k] = rest.join(":")
  }
  return out
}

function formatEnum(value: unknown) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function normalizeText(v: unknown) {
  return String(v || "").trim()
}

function buildSearchParams(input: Record<string, string>) {
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(input)) {
    const t = normalizeText(v)
    if (!t) continue
    next.set(k, t)
  }
  return next
}

function uniqStrings(list: unknown) {
  const arr = Array.isArray(list) ? list : []
  return Array.from(new Set(arr.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean)))
}

function splitTokens(raw: string) {
  return raw
    .split(/[,\n]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
}

function formatRelativeTime(dateString: string | null | undefined) {
  if (!dateString) return ""
  const d = new Date(dateString)
  const t = d.getTime()
  if (!Number.isFinite(t)) return ""

  const now = Date.now()
  const diffMs = now - t
  if (diffMs <= 0) return "just now"

  const diffMin = diffMs / 60000
  if (diffMin < 60) {
    const v = Math.max(1, Math.floor(diffMin))
    return `${v} min ago`
  }

  const diffH = diffMin / 60
  if (diffH < 24) {
    const v = Math.max(1, Math.floor(diffH))
    return `${v} hour${v === 1 ? "" : "s"} ago`
  }

  const diffD = diffH / 24
  if (diffD < 7) {
    const v = Math.max(1, Math.floor(diffD))
    return `${v} day${v === 1 ? "" : "s"} ago`
  }

  if (diffD < 30) {
    const v = Math.max(1, Math.floor(diffD / 7))
    return `${v} week${v === 1 ? "" : "s"} ago`
  }

  if (diffD < 365) {
    const v = Math.max(1, Math.floor(diffD / 30))
    return `${v} month${v === 1 ? "" : "s"} ago`
  }

  const v = Math.max(1, Math.floor(diffD / 365))
  return `${v} year${v === 1 ? "" : "s"} ago`
}

function formatSalary(job: Job) {
  const min = Number((job as any).salary_min || 0) || 0
  const max = Number((job as any).salary_max || 0) || 0
  if (!min && !max) return "Competitive"
  const f = (n: number) => `₹${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`
  const range = min && max ? `${f(min)} - ${f(max)}` : min ? f(min) : f(max)
  const suffix = (job as any).salary_type ? ` / ${formatEnum((job as any).salary_type)}` : ""
  return `${range}${suffix}`
}

export function JobsBoardClient({
  jobs = [],
  clientsById = {},
  embedded = false
}: {
  jobs?: Job[]
  clientsById?: Record<string, ClientLite>
  embedded?: boolean
}) {
  const profileRef = useRef<HTMLDivElement | null>(null)
  const { session, loading: sessionLoading } = useSupabaseSession()
  const accessToken = session?.access_token
  const sessionUserId = (session as any)?.user?.id ? String((session as any).user.id) : ""
  const googleAvatarUrl =
    (session as any)?.user?.user_metadata?.avatar_url && typeof (session as any).user.user_metadata.avatar_url === "string"
      ? String((session as any).user.user_metadata.avatar_url)
      : ""
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const restoredRef = useRef(false)

  const scrollKey = useMemo(() => {
    const next = new URLSearchParams(sp.toString())
    next.delete("createProfile")
    next.delete("login")
    next.delete("apply")
    return `jobsScroll:${pathname}?${next.toString()}`
  }, [pathname, sp])

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    try {
      const raw = window.sessionStorage.getItem(scrollKey)
      if (!raw) return
      const y = Number(raw)
      if (!Number.isFinite(y)) return
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: y, behavior: "instant" as any })
      })
    } catch {}
  }, [scrollKey])

  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [candidateLoading, setCandidateLoading] = useState(false)

  const [resultsJobs, setResultsJobs] = useState<Job[]>(jobs)
  const [resultsTotal, setResultsTotal] = useState(0)
  const [resultsClientsById, setResultsClientsById] = useState<Record<string, ClientLite>>(clientsById)
  const [resultsLoading, setResultsLoading] = useState(false)
  const [resultsError, setResultsError] = useState<string | null>(null)
  const [resultsUsedProfileFallback, setResultsUsedProfileFallback] = useState(false)
  const [resultsLoadedOnce, setResultsLoadedOnce] = useState(false)
  const [resultsHasMore, setResultsHasMore] = useState(false)

  const pageSize = 15

  const [draftQ, setDraftQ] = useState("")
  const [draftTextTokens, setDraftTextTokens] = useState<string[]>([])
  const [draftExperience, setDraftExperience] = useState<string>("any")
  const [draftLocation, setDraftLocation] = useState<string>("")
  const [draftLocationTokens, setDraftLocationTokens] = useState<string[]>([])
  const [draftSkills, setDraftSkills] = useState<string[]>([])
  const [draftSkillInput, setDraftSkillInput] = useState("")

  const [draftEmploymentType, setDraftEmploymentType] = useState<string>("any")
  const [draftShiftType, setDraftShiftType] = useState<string>("any")
  const [draftDepartment, setDraftDepartment] = useState<string>("any")
  const [draftRoleCategory, setDraftRoleCategory] = useState<string>("any")
  const [draftSalaryMin, setDraftSalaryMin] = useState<string>("")
  const [draftSalaryMax, setDraftSalaryMax] = useState<string>("")
  const [draftSort, setDraftSort] = useState<string>("recent")

  const [appliedQ, setAppliedQ] = useState("")
  const [appliedExperience, setAppliedExperience] = useState<string>("any")
  const [appliedLocation, setAppliedLocation] = useState<string>("")
  const [appliedSkills, setAppliedSkills] = useState<string[]>([])
  const [appliedEmploymentType, setAppliedEmploymentType] = useState<string>("any")
  const [appliedShiftType, setAppliedShiftType] = useState<string>("any")
  const [appliedDepartment, setAppliedDepartment] = useState<string>("any")
  const [appliedRoleCategory, setAppliedRoleCategory] = useState<string>("any")
  const [appliedSalaryMin, setAppliedSalaryMin] = useState<string>("")
  const [appliedSalaryMax, setAppliedSalaryMax] = useState<string>("")
  const [appliedSort, setAppliedSort] = useState<string>("recent")
  const [appliedPage, setAppliedPage] = useState(1)

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [filterSections, setFilterSections] = useState<Record<string, boolean>>({
    experience: true,
    salary: true,
    work_type: false,
    work_shift: false,
    department: false,
    role: false
  })
  const [mobileFilterSection, setMobileFilterSection] = useState<
    "sort" | "salary" | "experience" | "work_type" | "work_shift" | "department" | "role" | "prefs"
  >("sort")

  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<"create" | "login">("create")

  const [profileRoleFilterOn, setProfileRoleFilterOn] = useState(true)

  const [prefsBusy, setPrefsBusy] = useState(false)
  const [prefsError, setPrefsError] = useState<string | null>(null)

  const [prefLocDraft, setPrefLocDraft] = useState("")
  const [prefLocFocused, setPrefLocFocused] = useState(false)

  const [qFocused, setQFocused] = useState(false)
  const [qSuggestions, setQSuggestions] = useState<string[]>([])
  const [qSuggestBusy, setQSuggestBusy] = useState(false)

  const [selectionModalOpen, setSelectionModalOpen] = useState(false)

  const [pendingExternalJob, setPendingExternalJob] = useState<Job | null>(null)
  const [didYouApplyJob, setDidYouApplyJob] = useState<Job | null>(null)
  const [didYouApplyBusy, setDidYouApplyBusy] = useState(false)
  const [appliedJobIds, setAppliedJobIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<"detailed" | "compact">("detailed")
  const [navigatingJobId, setNavigatingJobId] = useState<string | null>(null)

  const externalApplyOpenedRef = useRef<{ jobId: string | null; ts: number }>({ jobId: null, ts: 0 })

  const recentlyOpenedExternalApply = (jobId: string) => {
    const cur = externalApplyOpenedRef.current
    return cur.jobId === jobId && Date.now() - cur.ts < 2500
  }

  useEffect(() => {
    if (session && pendingExternalJob) {
      const job = pendingExternalJob
      setPendingExternalJob(null)
      setDidYouApplyJob(job)
      const url = (job as any).external_apply_url || (job as any).external_link || "#"
      if (!recentlyOpenedExternalApply(job.id)) {
        externalApplyOpenedRef.current = { jobId: job.id, ts: Date.now() }
        window.open(url, "_blank")
      }
    }
  }, [session, pendingExternalJob])

  const startExternalApply = (job: Job) => {
    const isExternal = String((job as any).apply_type || "in_platform") === "external"
    if (!isExternal) return
    if (pendingExternalJob || didYouApplyJob) return

    if (!session) {
      setPendingExternalJob(job)
      openAuth("create")
      return
    }

    setDidYouApplyJob(job)
    const url = (job as any).external_apply_url || (job as any).external_link || "#"
    if (!recentlyOpenedExternalApply(job.id)) {
      externalApplyOpenedRef.current = { jobId: job.id, ts: Date.now() }
      window.open(url, "_blank")
    }
  }

  const handleDidYouApply = async (applied: boolean) => {
    if (!didYouApplyJob || !session) return
    setDidYouApplyBusy(true)
    try {
      if (applied) {
        await fetch("/api/candidate/applications/submit", {
          method: "POST",
          headers: bearerHeaders(accessToken),
          body: JSON.stringify({ jobId: didYouApplyJob.id })
        })
        setAppliedJobIds((prev) => (prev.includes(didYouApplyJob.id) ? prev : [...prev, didYouApplyJob.id]))
      }
      setDidYouApplyJob(null)
    } catch {
      // ignore
    } finally {
      setDidYouApplyBusy(false)
    }
  }

  useEffect(() => {
    const wantsCreate = sp.get("createProfile") === "1"
    const wantsLogin = sp.get("login") === "1"
    if ((wantsCreate || wantsLogin) && sessionLoading) return
    if (wantsCreate && !session) {
      setAuthMode("create")
      setAuthOpen(true)
    }
    if (wantsLogin && !session) {
      setAuthMode("login")
      setAuthOpen(true)
    }
  }, [session, sessionLoading, sp])

  useEffect(() => {
    const q = normalizeText(sp.get("text") || sp.get("q") || "")
    const exp = normalizeText(sp.get("exp") || sp.get("min_experience") || "")
    const loc = normalizeText(sp.get("location_name") || sp.get("location") || "")
    const jobType = normalizeText(sp.get("jobType") || "")
    const shift = normalizeText(sp.get("shift") || "")
    const dept = normalizeText(sp.get("dept") || "")
    const roleCat = normalizeText(sp.get("role") || sp.get("roleCat") || "")
    const salMin = normalizeText(sp.get("salaryMin") || "")
    const salMax = normalizeText(sp.get("salaryMax") || "")
    const skillsRaw = normalizeText(sp.get("skills") || "")
    const sortRaw = normalizeText(sp.get("sort") || "")
    const pageRaw = normalizeText(sp.get("page") || "")

    const resolvedExp = exp ? exp : "any"

    const textTokens = Array.from(new Set(splitTokens(q))).slice(0, 12)
    const locTokens = Array.from(new Set(splitTokens(loc))).filter((x) => x !== "Anywhere in India").slice(0, 8)
    const resolvedLoc = locTokens.join(",")

    setAppliedQ(textTokens.join(","))
    setAppliedExperience(resolvedExp)
    setAppliedLocation(resolvedLoc)
    setAppliedEmploymentType(jobType || "any")
    setAppliedShiftType(shift || "any")
    setAppliedDepartment(dept || "any")
    setAppliedRoleCategory(roleCat || "any")
    setAppliedSalaryMin(salMin)
    setAppliedSalaryMax(salMax)

    const skills = skillsRaw
      ? Array.from(new Set(skillsRaw.split(",").map((s) => s.trim()).filter(Boolean))).slice(0, 12)
      : []
    setAppliedSkills(skills)

    const defaultSort = session ? "relevant" : "recent"
    const nextSort = sortRaw === "relevant" || sortRaw === "recent" ? sortRaw : defaultSort
    setAppliedSort(nextSort)

    const nextPage = Math.max(1, Number(pageRaw || "1") || 1)
    setAppliedPage(nextPage)

    setDraftQ("")
    setDraftTextTokens(textTokens)
    setDraftExperience(resolvedExp)
    setDraftLocation("")
    setDraftLocationTokens(locTokens)
    setDraftEmploymentType(jobType || "any")
    setDraftShiftType(shift || "any")
    setDraftDepartment(dept || "any")
    setDraftRoleCategory(roleCat || "any")
    setDraftSalaryMin(salMin)
    setDraftSalaryMax(salMax)
    setDraftSkills(skills)
    setDraftSort(nextSort)
  }, [session, sp])

  useEffect(() => {
    if (!accessToken || !sessionUserId) {
      setAppliedJobIds([])
      return
    }
    let cancelled = false
    cachedFetchJson<{ applications: Array<{ job_id?: string | null }> }>(
      `boardapp:applications:${sessionUserId}`,
      "/api/candidate/applications",
      { headers: bearerHeaders(accessToken) },
      { ttlMs: 2 * 60_000 }
    )
      .then((data) => {
        if (cancelled) return
        const ids = Array.isArray(data?.applications)
          ? data.applications
              .map((app) => String((app as any)?.job_id || "").trim())
              .filter(Boolean)
          : []
        setAppliedJobIds(Array.from(new Set(ids)))
      })
      .catch(() => {
        if (!cancelled) setAppliedJobIds([])
      })
    return () => {
      cancelled = true
    }
  }, [accessToken, sessionUserId])

  const appliedJobIdSet = useMemo(() => new Set(appliedJobIds), [appliedJobIds])

  useEffect(() => {
    const q = draftQ.trim()
    if (!qFocused || q.length < 2) {
      setQSuggestions([])
      setQSuggestBusy(false)
      return
    }
    const handle = window.setTimeout(async () => {
      setQSuggestBusy(true)
      try {
        const data = await cachedFetchJson<any>(
          `boardapp:jobsSuggest:${q.toLowerCase()}`,
          `/api/public/jobs/suggest?text=${encodeURIComponent(q)}&limit=8`,
          undefined,
          { ttlMs: 5 * 60_000 }
        )
        const items = Array.isArray(data?.items) ? data.items.filter((x: any) => typeof x === "string").map((x: string) => x.trim()).filter(Boolean) : []
        setQSuggestions(items.slice(0, 8))
      } catch {
        setQSuggestions([])
      } finally {
        setQSuggestBusy(false)
      }
    }, 140)
    return () => window.clearTimeout(handle)
  }, [draftQ, qFocused])

  const localQSuggestions = useMemo(() => {
    const q = draftQ.trim()
    if (!q) return MIGRATION_TOP_JOB_TITLES.slice(0, 8)
    return getSuggestionMatches(q, MIGRATION_ALL_SUGGESTIONS, 10)
  }, [draftQ])

  const mergedQSuggestions = useMemo(() => {
    const out: string[] = []
    const seen = new Set<string>()
    const push = (v: string) => {
      const t = v.trim()
      if (!t) return
      const key = t.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      out.push(t)
    }
    for (const s of localQSuggestions) push(s)
    for (const s of qSuggestions) push(s)
    return out.slice(0, 12)
  }, [localQSuggestions, qSuggestions])

  const roleCategoryOptions = useMemo(() => {
    const out = new Set<string>()
    for (const j of resultsJobs) {
      const v = String((j as any).role_category || "").trim()
      if (v) out.add(v)
    }
    return Array.from(out)
  }, [resultsJobs])

  useEffect(() => {
    if (!accessToken) {
      setCandidate(null)
      return
    }
    setCandidateLoading(true)
    cachedFetchJson<{ candidate: Candidate | null }>(
      `boardapp:candidateProfile:${sessionUserId || "anon"}`,
      "/api/candidate/profile",
      { headers: bearerHeaders(accessToken) },
      { ttlMs: 5 * 60_000 },
    )
      .then((data) => setCandidate((data?.candidate || null) as Candidate | null))
      .finally(() => setCandidateLoading(false))
  }, [accessToken, sessionUserId])

  useEffect(() => {
    const v = typeof candidate?.preferred_location === "string" ? candidate.preferred_location.trim() : ""
    setPrefLocDraft(v)
  }, [candidate?.preferred_location])

  useEffect(() => {
    const uid = (session as any)?.user?.id ? String((session as any).user.id) : ""
    if (!uid) return
    try {
      const raw = window.localStorage.getItem(`jobsProfileRoleFilterOff:${uid}`)
      if (raw) setProfileRoleFilterOn(false)
    } catch {}
  }, [session])

  const enableProfileRoleFilter = () => {
    const uid = (session as any)?.user?.id ? String((session as any).user.id) : ""
    setProfileRoleFilterOn(true)
    if (!uid) return
    try {
      window.localStorage.removeItem(`jobsProfileRoleFilterOff:${uid}`)
    } catch {}
  }

  const fetchJobsPage = async () => {
    setResultsLoading(true)
    setResultsError(null)
    try {
      const qp = new URLSearchParams()
      if (appliedQ.trim()) qp.set("text", appliedQ.trim())
      if (appliedLocation.trim()) qp.set("location_name", appliedLocation.trim())
      if (appliedSkills.length) qp.set("skills", appliedSkills.join(","))
      if (appliedEmploymentType !== "any") qp.set("jobType", appliedEmploymentType)
      if (appliedShiftType !== "any") qp.set("shift", appliedShiftType)
      if (appliedDepartment !== "any") qp.set("dept", appliedDepartment)
      if (appliedRoleCategory !== "any") qp.set("role", appliedRoleCategory)
      if (appliedExperience !== "any") qp.set("exp", appliedExperience)
      if (appliedSalaryMin) qp.set("salaryMin", appliedSalaryMin)
      if (appliedSalaryMax) qp.set("salaryMax", appliedSalaryMax)
      if (appliedSort) qp.set("sort", appliedSort)
      qp.set("page", String(appliedPage))
      qp.set("pageSize", String(pageSize))

      const profileRoleTerms = Array.from(
        new Set([
          ...uniqStrings((candidate as any)?.preferred_roles),
          ...(typeof candidate?.desired_role === "string" && candidate.desired_role.trim() ? [candidate.desired_role.trim()] : [])
        ])
      ).slice(0, 12)

      if (session && profileRoleFilterOn && profileRoleTerms.length) {
        qp.set("profileRoleFilter", "1")
        qp.set("role_terms", profileRoleTerms.join(","))
      }

      const url = `/api/public/jobs/search?${qp.toString()}`
      const cacheKey = `boardapp:jobsSearch:${url}`
      const data = await cachedFetchJson<any>(cacheKey, url, undefined, { ttlMs: 5 * 60_000 })

      const pageJobs = Array.isArray(data?.jobs) ? (data.jobs as Job[]) : ([] as Job[])
      const pageClients = data?.clientsById && typeof data.clientsById === "object" ? (data.clientsById as Record<string, ClientLite>) : {}

      const hasMore = Boolean(data?.hasMore)
      const total = Number(data?.total || 0)

      setResultsClientsById(pageClients)
      setResultsJobs(pageJobs)
      setResultsTotal(total)
      setResultsHasMore(hasMore)
      setResultsUsedProfileFallback(Boolean(data?.usedProfileFallback))
      setResultsLoadedOnce(true)
    } catch (e: any) {
      setResultsError(e?.message || "Failed to load jobs")
      setResultsJobs([])
      setResultsTotal(0)
      setResultsClientsById({})
      setResultsHasMore(false)
    } finally {
      setResultsLoading(false)
    }
  }

  useEffect(() => {
    fetchJobsPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appliedQ,
    appliedLocation,
    appliedSkills.join(","),
    appliedEmploymentType,
    appliedShiftType,
    appliedDepartment,
    appliedRoleCategory,
    appliedExperience,
    appliedSalaryMin,
    appliedSalaryMax,
    appliedSort,
    appliedPage,
    session,
    profileRoleFilterOn,
    candidate?.desired_role || "",
    Array.isArray((candidate as any)?.preferred_roles) ? String(((candidate as any).preferred_roles as unknown[]).join(",")) : "",
    candidate?.updated_at || ""
  ])

  const disableProfileRoleFilter = () => {
    const uid = (session as any)?.user?.id ? String((session as any).user.id) : ""
    setProfileRoleFilterOn(false)
    if (!uid) return
    try {
      window.localStorage.setItem(`jobsProfileRoleFilterOff:${uid}`, "1")
    } catch {}
  }

  const explicitPreferredRoles = useMemo(() => {
    return uniqStrings((candidate as any)?.preferred_roles).slice(0, 12)
  }, [candidate])

  const desiredRole = useMemo(() => {
    const desired = typeof candidate?.desired_role === "string" ? candidate.desired_role.trim() : ""
    return desired || ""
  }, [candidate])

  const roleBoostTerms = useMemo(() => {
    return Array.from(new Set([...(explicitPreferredRoles || []), ...(desiredRole ? [desiredRole] : [])])).slice(0, 12)
  }, [desiredRole, explicitPreferredRoles])

  const preferredJobTypes = useMemo(() => {
    return uniqStrings((candidate as any)?.open_job_types)
  }, [candidate])

  const candidateAvatarUrl = useMemo(() => {
    const map = tagsToMap(candidate?.tags)
    return typeof map.avatar_url === "string" ? map.avatar_url : ""
  }, [candidate?.tags])

  const preferredLocation = useMemo(() => {
    const v = typeof candidate?.preferred_location === "string" ? candidate.preferred_location.trim() : ""
    return v || ""
  }, [candidate])

  const suggestedSkills = useMemo(() => {
    const fromProfile = uniqStrings((candidate as any)?.technical_skills)
    return Array.from(new Set([...fromProfile, ...MIGRATION_TOP_SKILLS, ...SKILL_SUGGESTIONS])).slice(0, 60)
  }, [candidate])

  const skillTypeahead = useMemo(() => {
    const taken = new Set(draftSkills.map((s) => s.toLowerCase()))
    const base = getSuggestionMatches(draftSkillInput, suggestedSkills, 60)
    return base.filter((x) => !taken.has(x.toLowerCase())).slice(0, 24)
  }, [draftSkillInput, draftSkills, suggestedSkills])

  const locationTypeahead = useMemo(() => {
    return getSuggestionMatches(draftLocation, LOCATION_PRESETS, 10)
  }, [draftLocation])

  const prefLocationTypeahead = useMemo(() => {
    const q = prefLocDraft.trim().toLowerCase()
    if (!q) return [] as string[]
    return LOCATION_PRESETS.filter((x) => x.toLowerCase().includes(q)).slice(0, 10)
  }, [prefLocDraft])

  const addDraftSkill = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    setDraftSkills((prev) => Array.from(new Set([...prev, t])).slice(0, 12))
    setDraftSkillInput("")
  }

  const removeDraftSkill = (skill: string) => {
    setDraftSkills((prev) => prev.filter((s) => s !== skill))
  }

  const addDraftTextToken = (raw: string) => {
    const parts = splitTokens(raw)
    if (!parts.length) return
    setDraftTextTokens((prev) => Array.from(new Set([...prev, ...parts])).slice(0, 12))
    setDraftQ("")
    setQSuggestions([])
  }

  const removeDraftTextToken = (token: string) => {
    setDraftTextTokens((prev) => prev.filter((t) => t !== token))
  }

  const addDraftLocationToken = (raw: string) => {
    const parts = splitTokens(raw).filter((x) => x !== "Anywhere in India")
    if (!parts.length) return
    setDraftLocationTokens((prev) => Array.from(new Set([...prev, ...parts])).slice(0, 8))
    setDraftLocation("")
  }

  const removeDraftLocationToken = (token: string) => {
    setDraftLocationTokens((prev) => prev.filter((t) => t !== token))
  }

  const locationPlaceholder = useMemo(() => {
    if (draftLocationTokens.length) return "Add another location"
    if (preferredLocation && preferredLocation !== "Anywhere in India") return preferredLocation
    return "e.g. Bhiwandi, Manesar, Sriperumbudur"
  }, [draftLocationTokens.length, preferredLocation])

  const [roleModalOpen, setRoleModalOpen] = useState(false)
  const [sortModalOpen, setSortModalOpen] = useState(false)
  const [roleModalBusy, setRoleModalBusy] = useState(false)
  const [roleModalError, setRoleModalError] = useState<string | null>(null)
  const [roleModalQuery, setRoleModalQuery] = useState("")
  const [roleModalSelected, setRoleModalSelected] = useState<string[]>([])
  const [roleModalSuggestions, setRoleModalSuggestions] = useState<string[]>([])

  const [skillFocused, setSkillFocused] = useState(false)
  const [locationFocused, setLocationFocused] = useState(false)

  const openRoleModal = async () => {
    if (!session || !accessToken) return
    setRoleModalError(null)
    setRoleModalOpen(true)
    setRoleModalSelected(uniqStrings((candidate as any)?.preferred_roles))
    setRoleModalSuggestions([])
    setRoleModalBusy(true)
    try {
      const data = await cachedFetchJson<any>(
        `boardapp:preferencesSuggest:${sessionUserId || "anon"}`,
        "/api/candidate/preferences/suggest",
        { headers: bearerHeaders(accessToken) },
        { ttlMs: 30 * 60_000 }
      )
      const list = Array.isArray(data?.suggested_roles)
        ? (data.suggested_roles as unknown[]).filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean)
        : []
      setRoleModalSuggestions(Array.from(new Set(list)).slice(0, 24))
    } catch (e: any) {
      setRoleModalError(e?.message || "Failed to load suggestions")
      setRoleModalSuggestions([])
    } finally {
      setRoleModalBusy(false)
    }
  }

  const closeRoleModal = useCallback(() => {
    setRoleModalOpen(false)
    setRoleModalQuery("")
    setRoleModalError(null)
  }, [])

  const openAuth = useCallback((mode: "create" | "login") => {
    setAuthMode(mode)
    setAuthOpen(true)
    const next = new URLSearchParams(sp.toString())
    next.delete("createProfile")
    next.delete("login")
    next.set("returnTo", "/dashboard/jobs")
    next.set(mode === "create" ? "createProfile" : "login", "1")
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [pathname, router, sp])

  const closeAuth = useCallback(() => {
    setAuthOpen(false)
    const next = new URLSearchParams(sp.toString())
    next.delete("createProfile")
    next.delete("login")
    next.delete("returnTo")
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false })
  }, [pathname, router, sp])

  const signOut = async () => {
    await supabase.auth.signOut()
    setCandidate(null)
    invalidateSessionCache("boardapp:candidateProfile:", { prefix: true })
    invalidateSessionCache("boardapp:jobsSearch:", { prefix: true })
  }

  const updateCandidate = async (patch: Partial<Candidate>) => {
    if (!accessToken) return
    setPrefsBusy(true)
    setPrefsError(null)
    try {
      const res = await fetch("/api/candidate/profile", {
        method: "PUT",
        headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify(patch)
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Failed to update")
      setCandidate((data?.candidate || null) as Candidate | null)
      invalidateSessionCache("boardapp:candidateProfile:", { prefix: true })
      invalidateSessionCache("boardapp:jobsSearch:", { prefix: true })
    } catch (e: any) {
      setPrefsError(e.message || "Failed to update")
    } finally {
      setPrefsBusy(false)
    }
  }

  const applyRoleModal = async () => {
    const next = Array.from(new Set(roleModalSelected.map((x) => x.trim()).filter(Boolean))).slice(0, 12)
    await updateCandidate({ preferred_roles: next } as any)
    closeRoleModal()
  }

  const toggleJobType = async (t: string) => {
    const cur = uniqStrings((candidate as any)?.open_job_types)
    const set = new Set(cur)
    if (set.has(t)) set.delete(t)
    else set.add(t)
    await updateCandidate({ open_job_types: Array.from(set) } as any)
  }

  const applySearch = (override?: { text?: string }) => {
    const nextTextTokens = Array.from(
      new Set([
        ...draftTextTokens,
        ...splitTokens(typeof override?.text === "string" ? override.text : draftQ)
      ].map((x) => x.trim()).filter(Boolean))
    ).slice(0, 12)

    const nextLocTokens = Array.from(
      new Set([
        ...draftLocationTokens,
        ...splitTokens(draftLocation)
      ].map((x) => x.trim()).filter(Boolean))
    )
      .filter((x) => x !== "Anywhere in India")
      .slice(0, 8)

    const next = buildSearchParams({
      text: nextTextTokens.join(","),
      location_name: nextLocTokens.join(","),
      skills: draftSkills.length ? draftSkills.join(",") : "",
      jobType: draftEmploymentType !== "any" ? draftEmploymentType : "",
      shift: draftShiftType !== "any" ? draftShiftType : "",
      dept: draftDepartment !== "any" ? draftDepartment : "",
      exp: draftExperience !== "any" ? draftExperience : "",
      role: draftRoleCategory !== "any" ? draftRoleCategory : "",
      salaryMin: draftSalaryMin,
      salaryMax: draftSalaryMax,
      sort: draftSort,
    })
    if (next.toString()) next.set("search", "true")
    next.set("page", "1")
    const qs = next.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
    setFiltersOpen(false)
    setDraftQ("")
    setDraftLocation("")
  }

  const applySort = (nextSort: string) => {
    setDraftSort(nextSort)
    const nextTextTokens = Array.from(new Set([...draftTextTokens, ...splitTokens(draftQ)].map((x) => x.trim()).filter(Boolean))).slice(0, 12)
    const nextLocTokens = Array.from(new Set([...draftLocationTokens, ...splitTokens(draftLocation)].map((x) => x.trim()).filter(Boolean)))
      .filter((x) => x !== "Anywhere in India")
      .slice(0, 8)
    const next = buildSearchParams({
      text: nextTextTokens.join(","),
      location_name: nextLocTokens.join(","),
      skills: draftSkills.length ? draftSkills.join(",") : "",
      jobType: draftEmploymentType !== "any" ? draftEmploymentType : "",
      shift: draftShiftType !== "any" ? draftShiftType : "",
      dept: draftDepartment !== "any" ? draftDepartment : "",
      exp: draftExperience !== "any" ? draftExperience : "",
      role: draftRoleCategory !== "any" ? draftRoleCategory : "",
      salaryMin: draftSalaryMin,
      salaryMax: draftSalaryMax,
      sort: nextSort,
    })
    if (next.toString()) next.set("search", "true")
    next.set("page", "1")
    const qs = next.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const clearAll = () => {
    setDraftQ("")
    setDraftTextTokens([])
    setDraftExperience("any")
    setDraftLocation("")
    setDraftLocationTokens([])
    setDraftSkills([])
    setDraftSkillInput("")
    setDraftEmploymentType("any")
    setDraftShiftType("any")
    setDraftDepartment("any")
    setDraftRoleCategory("any")
    setDraftSalaryMin("")
    setDraftSalaryMax("")
    setDraftSort(session ? "relevant" : "recent")
    router.push(pathname)
    setFiltersOpen(false)
  }

  const draftHasMeaningfulSearch = Boolean(
    draftQ.trim() ||
      draftTextTokens.length ||
      draftLocation.trim() ||
      draftLocationTokens.length ||
      draftSkills.length ||
      draftExperience !== "any" ||
      draftEmploymentType !== "any" ||
      draftShiftType !== "any" ||
      draftDepartment !== "any" ||
      draftRoleCategory !== "any" ||
      Boolean(draftSalaryMin) ||
      Boolean(draftSalaryMax)
  )

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; value: string }> = []
    if (appliedQ.trim()) chips.push({ key: "text", label: "Search", value: appliedQ.trim() })
    if (appliedExperience !== "any") chips.push({ key: "exp", label: "Experience", value: appliedExperience })
    if (appliedLocation.trim()) chips.push({ key: "location_name", label: "Location", value: appliedLocation.trim() })
    if (appliedSkills.length) chips.push({ key: "skills", label: "Skills", value: appliedSkills.join(", ") })
    if (appliedEmploymentType !== "any") chips.push({ key: "jobType", label: "Job type", value: formatEnum(appliedEmploymentType) })
    if (appliedShiftType !== "any") chips.push({ key: "shift", label: "Shift", value: formatEnum(appliedShiftType) })
    if (appliedDepartment !== "any") chips.push({ key: "dept", label: "Department", value: formatEnum(appliedDepartment) })
    if (appliedRoleCategory !== "any") chips.push({ key: "role", label: "Role", value: formatEnum(appliedRoleCategory) })
    if (appliedSalaryMin || appliedSalaryMax) {
      const lo = appliedSalaryMin ? `₹${appliedSalaryMin}` : "0"
      const hi = appliedSalaryMax ? `₹${appliedSalaryMax}` : "Any"
      chips.push({ key: "salary", label: "Salary", value: `${lo} - ${hi}` })
    }
    if (appliedSort && ((session && appliedSort !== "relevant") || (!session && appliedSort !== "recent"))) {
      chips.push({ key: "sort", label: "Sort", value: appliedSort === "relevant" ? "Relevant" : "Most recent" })
    }
    return chips
  }, [appliedDepartment, appliedEmploymentType, appliedExperience, appliedLocation, appliedQ, appliedRoleCategory, appliedSalaryMax, appliedSalaryMin, appliedShiftType, appliedSkills, appliedSort, session])

  const removeChip = (key: string) => {
    const next = new URLSearchParams(sp.toString())
    if (key === "text") {
      next.delete("text")
      next.delete("q")
    } else if (key === "salary") {
      next.delete("salaryMin")
      next.delete("salaryMax")
    } else if (key === "skills") {
      next.delete("skills")
    } else {
      next.delete(key)
    }
    next.delete("search")
    if (
      next.get("text") ||
      next.get("q") ||
      next.get("exp") ||
      next.get("min_experience") ||
      next.get("location_name") ||
      next.get("location") ||
      next.get("skills") ||
      next.get("jobType") ||
      next.get("shift") ||
      next.get("dept") ||
      next.get("role") ||
      next.get("roleCat") ||
      next.get("salaryMin") ||
      next.get("salaryMax") ||
      next.get("sort")
    ) {
      next.set("search", "true")
    }
    const qs = next.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const toggleFilterSection = (id: string) => {
    setFilterSections((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const FiltersPanel = (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          <span>Filters</span>
          <span className="text-muted-foreground font-normal">({activeChips.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersCollapsed((v) => !v)}
            className="rounded-lg border border-border/60 bg-card/60 px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60 transition-colors"
          >
            {filtersCollapsed ? "Show" : "Hide"}
          </button>
          <button 
            type="button" 
            onClick={clearAll} 
            className="text-sm font-semibold text-primary hover:text-primary/90 transition-colors"
          >
            Clear all
          </button>
        </div>
      </div>

      {activeChips.length ? (
        <div className="flex flex-wrap gap-2">
          {activeChips.slice(0, 6).map((c) => (
            <button
              key={`f:${c.key}:${c.value}`}
              type="button"
              onClick={() => removeChip(c.key)}
              className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs text-foreground/80 hover:bg-accent/60 transition-all duration-200 shadow-sm shadow-black/20"
            >
              <span className="max-w-[170px] truncate font-medium">{c.value}</span>
              <span className="text-muted-foreground hover:text-foreground">×</span>
            </button>
          ))}
          {activeChips.length > 6 ? <span className="text-xs text-muted-foreground font-medium">+{activeChips.length - 6} more</span> : null}
        </div>
      ) : null}

      {filtersCollapsed ? (
        <div className="grid gap-2">
          <Button 
            className="rounded-xl font-medium"
            onClick={() => applySearch()}
          >
            Apply filters
          </Button>
        </div>
      ) : (
      <div className="grid gap-2">
        {[{ id: "experience", label: "Experience" },
          { id: "salary", label: "Salary" },
          { id: "work_type", label: "Work type" },
          { id: "work_shift", label: "Work shift" },
          { id: "department", label: "Department" },
          { id: "role", label: "Role" }
        ].map((sec) => (
          <div key={sec.id} className="overflow-hidden rounded-2xl border bg-background">
            <button
              type="button"
              onClick={() => toggleFilterSection(sec.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
            >
              <span>{sec.label}</span>
              <span className="text-muted-foreground">{filterSections[sec.id] ? "˄" : "˅"}</span>
            </button>

            {filterSections[sec.id] ? (
              <div className="border-t px-4 py-4">
                {sec.id === "experience" ? (
                    <select
                      value={draftExperience}
                      onChange={(e) => setDraftExperience(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                    >
                      <option value="any">All</option>
                      <option value="fresher">Fresher</option>
                      <option value="1_2">1-2 years</option>
                      <option value="3_5">3-5 years</option>
                      <option value="5_plus">5+ years</option>
                    </select>
                  ) : null}

                  {sec.id === "salary" ? (
                    <div className="grid gap-4">
                      <div className="text-sm text-muted-foreground">Monthly salary range</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">Min (₹)</label>
                          <input
                            type="number"
                            value={draftSalaryMin}
                            onChange={(e) => setDraftSalaryMin(e.target.value)}
                            placeholder="10000"
                            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">Max (₹)</label>
                          <input
                            type="number"
                            value={draftSalaryMax}
                            onChange={(e) => setDraftSalaryMax(e.target.value)}
                            placeholder="50000"
                            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {["10000", "20000", "30000", "50000", "100000"].map((amount) => (
                          <button
                            key={amount}
                            onClick={() => {
                              if (!draftSalaryMin) setDraftSalaryMin(amount)
                              else if (!draftSalaryMax) setDraftSalaryMax(amount)
                              else {
                                setDraftSalaryMin(amount)
                                setDraftSalaryMax("")
                              }
                            }}
                            className="rounded-md border border-border/60 bg-card/60 px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:bg-accent/60 transition-colors duration-200"
                          >
                            ₹{Number(amount) >= 100000 ? `${Number(amount) / 100000}L` : `${Number(amount) / 1000}k`}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {sec.id === "work_type" ? (
                    <select
                      value={draftEmploymentType}
                      onChange={(e) => setDraftEmploymentType(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                    >
                      <option value="any">All</option>
                      <option value="full_time">Full time</option>
                      <option value="part_time">Part time</option>
                      <option value="contract">Contract</option>
                    </select>
                  ) : null}

                  {sec.id === "work_shift" ? (
                    <select
                      value={draftShiftType}
                      onChange={(e) => setDraftShiftType(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                    >
                      <option value="any">All</option>
                      <option value="day">Day</option>
                      <option value="night">Night</option>
                      <option value="rotational">Rotational</option>
                    </select>
                  ) : null}

                  {sec.id === "department" ? (
                    <select
                      value={draftDepartment}
                      onChange={(e) => setDraftDepartment(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                    >
                      <option value="any">All</option>
                      <option value="operations">Operations</option>
                      <option value="fleet">Fleet</option>
                      <option value="dispatch">Dispatch</option>
                      <option value="warehouse">Warehouse</option>
                    </select>
                  ) : null}

                  {sec.id === "role" ? (
                    <select
                      value={draftRoleCategory}
                      onChange={(e) => setDraftRoleCategory(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                    >
                      <option value="any">All</option>
                      {roleCategoryOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {formatEnum(opt)}
                        </option>
                      ))}
                    </select>
                  ) : null}
              </div>
            ) : null}
          </div>
        ))}

        <Button className="rounded-xl" onClick={() => applySearch()}>
          Apply
        </Button>
      </div>
      )}
    </div>
  )

  const MobileFiltersPanel = (
    <div className="md:hidden">
      <div className="relative overflow-hidden rounded-3xl border bg-card">
        <button
          type="button"
          onClick={() => setFiltersOpen(false)}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground"
          aria-label="Close"
        >
          ×
        </button>

        <div className="flex h-[75vh] flex-col">
          <div className="flex flex-1 overflow-hidden">
            <div className="w-[160px] shrink-0 border-r bg-accent/60 p-2">
              {(
                [
                  { id: "sort", label: "Sort by" },
                  { id: "salary", label: "Salary" },
                  { id: "experience", label: "Experience" },
                  { id: "work_type", label: "Work type" },
                  { id: "work_shift", label: "Work shift" },
                  { id: "department", label: "Department" },
                  { id: "role", label: "Role" },
                  { id: "prefs", label: "Preferences" }
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMobileFilterSection(item.id)}
                  className={[
                    "relative w-full rounded-xl px-3 py-3 text-left text-sm",
                    mobileFilterSection === item.id ? "bg-background font-semibold" : "text-muted-foreground"
                  ].join(" ")}
                >
                  <span
                    className={[
                      "absolute left-0 top-0 h-full w-1 rounded-r-full",
                      mobileFilterSection === item.id ? "bg-primary" : "bg-transparent"
                    ].join(" ")}
                  />
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-auto p-4">
              {mobileFilterSection === "sort" ? (
                <div className="grid gap-3">
                  <div className="text-sm font-semibold">Sort by</div>
                  {[...(session ? ([{ id: "relevant", label: "Relevant" }] as const) : []),
                    { id: "recent", label: "Date posted - New to Old" } as const
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDraftSort(opt.id)}
                      className="flex w-full items-center gap-3 rounded-2xl border bg-background px-4 py-3 text-sm"
                    >
                      <span
                        className={[
                          "inline-flex h-5 w-5 items-center justify-center rounded-full border",
                          draftSort === opt.id ? "border-primary bg-primary text-primary-foreground" : "border-muted"
                        ].join(" ")}
                      >
                        {draftSort === opt.id ? "✓" : ""}
                      </span>
                      <span className={draftSort === opt.id ? "font-semibold" : "text-muted-foreground"}>{opt.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {mobileFilterSection === "salary" ? (
                <div className="grid gap-4">
                  <div className="text-sm font-semibold">Monthly salary range</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Min (₹)</label>
                      <input
                        type="number"
                        value={draftSalaryMin}
                        onChange={(e) => setDraftSalaryMin(e.target.value)}
                        placeholder="10000"
                        className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Max (₹)</label>
                      <input
                        type="number"
                        value={draftSalaryMax}
                        onChange={(e) => setDraftSalaryMax(e.target.value)}
                        placeholder="50000"
                        className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {["10000", "20000", "30000", "50000", "100000"].map((amount) => (
                      <button
                        key={amount}
                        onClick={() => {
                          if (!draftSalaryMin) setDraftSalaryMin(amount)
                          else if (!draftSalaryMax) setDraftSalaryMax(amount)
                          else {
                            setDraftSalaryMin(amount)
                            setDraftSalaryMax("")
                          }
                        }}
                        className="rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-xs font-medium text-foreground/80"
                      >
                        ₹{Number(amount) >= 100000 ? `${Number(amount) / 100000}L` : `${Number(amount) / 1000}k`}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {mobileFilterSection === "experience" ? (
                <div className="grid gap-3">
                  <div className="text-sm font-semibold">Experience</div>
                  {["any", "fresher", "1_2", "3_5", "5_plus"].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDraftExperience(v)}
                      className="flex w-full items-center gap-3 rounded-2xl border bg-background px-4 py-3 text-sm"
                    >
                      <span
                        className={[
                          "inline-flex h-5 w-5 items-center justify-center rounded-full border",
                          draftExperience === v ? "border-primary bg-primary text-primary-foreground" : "border-muted"
                        ].join(" ")}
                      >
                        {draftExperience === v ? "✓" : ""}
                      </span>
                      <span className={draftExperience === v ? "font-semibold" : "text-muted-foreground"}>
                        {v === "any" ? "Any" : v === "fresher" ? "Fresher" : v === "1_2" ? "1-2 years" : v === "3_5" ? "3-5 years" : "5+ years"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {mobileFilterSection === "work_type" ? (
                <div className="grid gap-3">
                  <div className="text-sm font-semibold">Work type</div>
                  {[
                    { id: "any", label: "Any" },
                    { id: "full_time", label: "Full time" },
                    { id: "part_time", label: "Part time" },
                    { id: "contract", label: "Contract" }
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDraftEmploymentType(opt.id)}
                      className="flex w-full items-center gap-3 rounded-2xl border bg-background px-4 py-3 text-sm"
                    >
                      <span
                        className={[
                          "inline-flex h-5 w-5 items-center justify-center rounded-full border",
                          draftEmploymentType === opt.id ? "border-primary bg-primary text-primary-foreground" : "border-muted"
                        ].join(" ")}
                      >
                        {draftEmploymentType === opt.id ? "✓" : ""}
                      </span>
                      <span className={draftEmploymentType === opt.id ? "font-semibold" : "text-muted-foreground"}>{opt.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {mobileFilterSection === "work_shift" ? (
                <div className="grid gap-3">
                  <div className="text-sm font-semibold">Work shift</div>
                  {[
                    { id: "any", label: "Any" },
                    { id: "day", label: "Day" },
                    { id: "night", label: "Night" },
                    { id: "rotational", label: "Rotational" }
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDraftShiftType(opt.id)}
                      className="flex w-full items-center gap-3 rounded-2xl border bg-background px-4 py-3 text-sm"
                    >
                      <span
                        className={[
                          "inline-flex h-5 w-5 items-center justify-center rounded-full border",
                          draftShiftType === opt.id ? "border-primary bg-primary text-primary-foreground" : "border-muted"
                        ].join(" ")}
                      >
                        {draftShiftType === opt.id ? "✓" : ""}
                      </span>
                      <span className={draftShiftType === opt.id ? "font-semibold" : "text-muted-foreground"}>{opt.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {mobileFilterSection === "department" ? (
                <div className="grid gap-3">
                  <div className="text-sm font-semibold">Department</div>
                  {[
                    { id: "any", label: "Any" },
                    { id: "operations", label: "Operations" },
                    { id: "fleet", label: "Fleet" },
                    { id: "dispatch", label: "Dispatch" },
                    { id: "warehouse", label: "Warehouse" }
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDraftDepartment(opt.id)}
                      className="flex w-full items-center gap-3 rounded-2xl border bg-background px-4 py-3 text-sm"
                    >
                      <span
                        className={[
                          "inline-flex h-5 w-5 items-center justify-center rounded-full border",
                          draftDepartment === opt.id ? "border-primary bg-primary text-primary-foreground" : "border-muted"
                        ].join(" ")}
                      >
                        {draftDepartment === opt.id ? "✓" : ""}
                      </span>
                      <span className={draftDepartment === opt.id ? "font-semibold" : "text-muted-foreground"}>{opt.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {mobileFilterSection === "role" ? (
                <div className="grid gap-3">
                  <div className="text-sm font-semibold">Role category</div>
                  <select
                    value={draftRoleCategory}
                    onChange={(e) => setDraftRoleCategory(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-input bg-background px-3 text-sm shadow-sm"
                  >
                    <option value="any">Any</option>
                    {roleCategoryOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {formatEnum(opt)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {mobileFilterSection === "prefs" ? (
                <div className="grid gap-4">
                  <div className="text-sm font-semibold">Preferences</div>

                  <div className="rounded-2xl border bg-background p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">Preferred title/role</div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!session || prefsBusy) return
                          openRoleModal()
                        }}
                        className="text-sm font-semibold text-primary"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(explicitPreferredRoles.length ? explicitPreferredRoles : desiredRole ? [desiredRole] : []).slice(0, 6).map((r) => (
                        <span key={r} className="rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs">
                          {r}
                        </span>
                      ))}
                      {!explicitPreferredRoles.length && !desiredRole ? (
                        <div className="text-sm text-muted-foreground">Add roles to filter jobs based on your profile</div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-background p-4">
                    <div className="text-sm font-semibold">Preferred location</div>
                    <div className="relative mt-3">
                      <Input
                        value={prefLocDraft}
                        onChange={(e) => setPrefLocDraft(e.target.value)}
                        onFocus={() => setPrefLocFocused(true)}
                        onBlur={() => {
                          window.setTimeout(() => setPrefLocFocused(false), 120)
                        }}
                        placeholder="e.g. Bhiwandi, Delhi NCR"
                      />
                      {prefLocFocused && prefLocDraft.trim() && prefLocationTypeahead.length ? (
                        <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-border/60 bg-popover shadow-lg shadow-black/10 dark:shadow-black/40">
                          {prefLocationTypeahead.map((opt) => (
                            <button
                              key={`prefLoc:${opt}`}
                              type="button"
                              onClick={() => setPrefLocDraft(opt)}
                              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-accent"
                            >
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate">{opt}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-3 flex items-center justify-end">
                      <Button
                        size="sm"
                        className="rounded-xl"
                        onClick={async () => {
                          if (!session || prefsBusy) return
                          await updateCandidate({ preferred_location: prefLocDraft.trim() } as any)
                          setPrefLocFocused(false)
                        }}
                        disabled={!session || prefsBusy}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t bg-background px-4 py-4">
            <button type="button" onClick={clearAll} className="text-sm font-semibold text-primary">
              Clear Filters
            </button>
            <button type="button" onClick={() => applySearch()} className="h-12 rounded-2xl bg-primary px-8 text-sm font-semibold text-primary-foreground">
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className={embedded ? "" : "min-h-screen bg-app"}>
      {embedded ? null : (
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur">
          <div className="flex h-16 w-full items-center justify-between px-4">
            <Link href="/jobs" className="flex items-center gap-2">
              <div className="h-9 w-28 overflow-hidden">
                <img 
                  src={BRAND_LOGO_URL} 
                  alt={BRAND_NAME} 
                  className="h-full w-full object-contain dark:invert transition-all duration-300" 
                />
              </div>
              {/* <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{BRAND_NAME} Jobs</div>
                <div className="text-xs text-muted-foreground truncate">Logistics • Transport • Supply Chain</div>
              </div> */}
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              {session ? (
                <>
                  <Link href="/dashboard/jobs">
                    <Button variant="secondary" size="sm">Dashboard</Button>
                  </Link>
                  <Button variant="secondary" size="sm" onClick={signOut}>Sign out</Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => openAuth("login")}>Log in</Button>
                  <Button size="sm" onClick={() => openAuth("create")}>Create profile</Button>
                </>
              )}
            </div>
          </div>
        </header>
      )}

      <main className={(embedded ? "w-full" : "w-full px-4 py-6") + " overflow-x-hidden"}>
        <div className={embedded ? "w-full" : "mx-auto w-full max-w-[1500px]"}>
        <Card className="shadow-sm">
          <CardBody className="pt-4 pb-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(320px,520px)_minmax(260px,340px)_minmax(220px,260px)_160px]">
              <div className="relative">
                <div className="h-12 rounded-full border border-input/70 bg-card/60 px-4 py-2 shadow-sm shadow-black/20 focus-within:ring-2 focus-within:ring-ring/30">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" />

                    {draftTextTokens.slice(0, 2).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => removeDraftTextToken(t)}
                        className="inline-flex shrink-0 items-center gap-2 rounded-full border bg-accent px-3 py-1 text-xs"
                      >
                        <span className="max-w-[140px] truncate">{t}</span>
                        <span className="text-muted-foreground">×</span>
                      </button>
                    ))}

                    {draftTextTokens.length > 2 ? (
                      <button
                        type="button"
                        onClick={() => setSelectionModalOpen(true)}
                        className="inline-flex shrink-0 items-center rounded-full border bg-background px-3 py-1 text-xs font-medium"
                      >
                        +{draftTextTokens.length - 2}
                      </button>
                    ) : null}

                    <input
                      value={draftQ}
                      onChange={(e) => setDraftQ(e.target.value)}
                      onFocus={() => setQFocused(true)}
                      onBlur={() => {
                        window.setTimeout(() => setQFocused(false), 120)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault()
                          addDraftTextToken(draftQ)
                        }
                        if (e.key === "Backspace" && !draftQ.trim() && draftTextTokens.length) {
                          removeDraftTextToken(draftTextTokens[draftTextTokens.length - 1])
                        }
                      }}
                      placeholder={draftTextTokens.length ? "Add another…" : "Role, company, skill…"}
                      className="min-w-[120px] flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                </div>

                {qFocused || draftQ.trim() ? (
                  <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[320px] overflow-auto rounded-2xl border border-border/60 bg-popover shadow-lg shadow-black/10 dark:shadow-black/40">
                    {draftQ.trim() ? (
                      <button
                        type="button"
                        onClick={() => applySearch()}
                        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate">Search for “{draftQ.trim()}”</span>
                        <span className="text-xs text-muted-foreground">Search</span>
                      </button>
                    ) : (
                      <div className="px-4 py-3 text-xs font-medium text-muted-foreground">Popular searches</div>
                    )}

                    {draftQ.trim().length >= 2 && qSuggestBusy ? (
                      <div className="px-4 py-3 text-sm text-muted-foreground">Searching…</div>
                    ) : null}

                    {mergedQSuggestions.length ? (
                      mergedQSuggestions.map((opt) => (
                        <button
                          key={`qopt:${opt}`}
                          type="button"
                          onClick={() => addDraftTextToken(opt)}
                          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-accent"
                        >
                          <span className="truncate">{opt}</span>
                          <span className="text-xs text-muted-foreground">Add</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-muted-foreground">No suggestions</div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-2">
                <div className="relative">
                  <div className="h-12 rounded-full border border-input/70 bg-card/60 px-4 py-2 shadow-sm shadow-black/20 focus-within:ring-2 focus-within:ring-ring/30">
                    <div className="flex items-center gap-2 overflow-hidden">
                    {draftSkills.slice(0, 1).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => removeDraftSkill(s)}
                        className="inline-flex shrink-0 items-center gap-2 rounded-full border bg-accent px-3 py-1 text-xs"
                      >
                        <span className="max-w-[140px] truncate">{s}</span>
                        <span className="text-muted-foreground">×</span>
                      </button>
                    ))}

                    {draftSkills.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setSelectionModalOpen(true)}
                        className="inline-flex shrink-0 items-center rounded-full border bg-background px-3 py-1 text-xs font-medium"
                      >
                        +{draftSkills.length - 1}
                      </button>
                    ) : null}
                    <input
                      value={draftSkillInput}
                      onChange={(e) => setDraftSkillInput(e.target.value)}
                      onFocus={() => setSkillFocused(true)}
                      onBlur={() => {
                        window.setTimeout(() => setSkillFocused(false), 120)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          addDraftSkill(draftSkillInput)
                        }
                      }}
                      placeholder={draftSkills.length ? "Add another skill" : "e.g. Warehouse Mgmt, Excel, Tally"}
                      className="min-w-[100px] flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                    </div>
                  </div>

                  {skillFocused || draftSkillInput.trim() ? (
                    <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[320px] overflow-auto rounded-2xl border border-border/60 bg-popover shadow-lg shadow-black/10 dark:shadow-black/40">
                      {draftSkillInput.trim() && !draftSkills.some((s) => s.toLowerCase() === draftSkillInput.trim().toLowerCase()) ? (
                        <button
                          type="button"
                          onClick={() => addDraftSkill(draftSkillInput)}
                          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-accent"
                        >
                          <span className="truncate">Add “{draftSkillInput.trim()}”</span>
                          <span className="text-xs text-muted-foreground">Add</span>
                        </button>
                      ) : null}

                      {skillTypeahead.map((opt) => (
                        <button
                          key={`skillopt:${opt}`}
                          type="button"
                          onClick={() => addDraftSkill(opt)}
                          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-accent"
                        >
                          <span className="truncate">{opt}</span>
                          <span className="text-xs text-muted-foreground">Add</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="relative">
                <div className="h-12 rounded-full border border-input/70 bg-card/60 px-4 py-2 shadow-sm shadow-black/20 focus-within:ring-2 focus-within:ring-ring/30">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />

                    {draftLocationTokens.slice(0, 1).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => removeDraftLocationToken(t)}
                        className="inline-flex shrink-0 items-center gap-2 rounded-full border bg-accent px-3 py-1 text-xs"
                      >
                        <span className="max-w-[140px] truncate">{t}</span>
                        <span className="text-muted-foreground">×</span>
                      </button>
                    ))}

                    {draftLocationTokens.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setSelectionModalOpen(true)}
                        className="inline-flex shrink-0 items-center rounded-full border bg-background px-3 py-1 text-xs font-medium"
                      >
                        +{draftLocationTokens.length - 1}
                      </button>
                    ) : null}

                    <input
                      value={draftLocation}
                      onChange={(e) => setDraftLocation(e.target.value)}
                      onFocus={() => setLocationFocused(true)}
                      onBlur={() => {
                        window.setTimeout(() => setLocationFocused(false), 120)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault()
                          addDraftLocationToken(draftLocation)
                        }
                        if (e.key === "Backspace" && !draftLocation.trim() && draftLocationTokens.length) {
                          removeDraftLocationToken(draftLocationTokens[draftLocationTokens.length - 1])
                        }
                      }}
                      placeholder={draftLocationTokens.length ? "Add location" : locationPlaceholder}
                      className="min-w-[100px] flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                </div>

                {locationFocused || draftLocation.trim() ? (
                  <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[320px] overflow-auto rounded-2xl border border-border/60 bg-popover shadow-lg shadow-black/10 dark:shadow-black/40">
                    {draftLocation.trim() && !LOCATION_PRESETS.some((x) => x.toLowerCase() === draftLocation.trim().toLowerCase()) ? (
                      <button
                        type="button"
                        onClick={() => addDraftLocationToken(draftLocation.trim())}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-accent"
                      >
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">Add “{draftLocation.trim()}”</span>
                      </button>
                    ) : null}

                    {locationTypeahead.map((opt) => (
                      <button
                        key={`locopt:${opt}`}
                        type="button"
                        onClick={() => addDraftLocationToken(opt)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-accent"
                      >
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{opt}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <Button
                size="lg"
                variant={draftHasMeaningfulSearch ? "primary" : "secondary"}
                className="rounded-full h-12"
                onClick={() => applySearch()}
              >
                Search jobs
              </Button>
            </div>

          </CardBody>
        </Card>

        <Modal open={selectionModalOpen} onClose={() => setSelectionModalOpen(false)} title="Selected filters" size="md">
          <div className="grid gap-5">
            <div>
              <div className="text-sm font-semibold">Search terms</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {draftTextTokens.length ? (
                  draftTextTokens.map((t) => (
                    <button
                      key={`sel:q:${t}`}
                      type="button"
                      onClick={() => removeDraftTextToken(t)}
                      className="inline-flex items-center gap-2 rounded-full border bg-accent px-3 py-1 text-xs"
                    >
                      <span className="max-w-[220px] truncate">{t}</span>
                      <span className="text-muted-foreground">×</span>
                    </button>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">No search terms selected.</div>
                )}
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold">Skills</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {draftSkills.length ? (
                  draftSkills.map((t) => (
                    <button
                      key={`sel:skill:${t}`}
                      type="button"
                      onClick={() => removeDraftSkill(t)}
                      className="inline-flex items-center gap-2 rounded-full border bg-accent px-3 py-1 text-xs"
                    >
                      <span className="max-w-[220px] truncate">{t}</span>
                      <span className="text-muted-foreground">×</span>
                    </button>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">No skills selected.</div>
                )}
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold">Locations</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {draftLocationTokens.length ? (
                  draftLocationTokens.map((t) => (
                    <button
                      key={`sel:loc:${t}`}
                      type="button"
                      onClick={() => removeDraftLocationToken(t)}
                      className="inline-flex items-center gap-2 rounded-full border bg-accent px-3 py-1 text-xs"
                    >
                      <span className="max-w-[220px] truncate">{t}</span>
                      <span className="text-muted-foreground">×</span>
                    </button>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">Anywhere in India.</div>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="h-11 flex-1 rounded-2xl"
                onClick={() => {
                  setDraftTextTokens([])
                  setDraftSkills([])
                  setDraftSkillInput("")
                  setDraftLocationTokens([])
                  setDraftLocation("")
                  setDraftQ("")
                }}
              >
                Clear all
              </Button>
              <Button
                className="h-11 flex-1 rounded-2xl"
                onClick={() => {
                  setSelectionModalOpen(false)
                  applySearch()
                }}
              >
                Search jobs
              </Button>
            </div>
          </div>
        </Modal>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm sm:text-base font-semibold text-foreground">
            Showing {resultsJobs.length} of {resultsTotal} jobs
          </div>
          <div className="flex items-center gap-2">
            <div className="lg:hidden flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setSortModalOpen(true)} className="gap-2 rounded-xl">
                <SlidersHorizontal className="h-4 w-4" />
                Sort
              </Button>
              <Button 
                variant="secondary" 
                size="sm" 
                onClick={() => setFiltersOpen(true)} 
                className="gap-2 rounded-xl"
              >
                <Filter className="h-4 w-4" />
                Filters
              </Button>
            </div>
            {!session ? (
              <select
                value={draftSort}
                onChange={(e) => applySort(e.target.value)}
                className="hidden h-9 rounded-xl border border-input/70 bg-card/60 px-3 text-sm text-foreground shadow-sm shadow-black/20 focus:outline-none focus:ring-2 focus:ring-ring/30 lg:block"
              >
                <option value="recent">Most recent</option>
                <option value="relevant">Most relevant</option>
              </select>
            ) : null}
            {activeChips.length ? (
              <Button variant="secondary" size="sm" className="rounded-xl" onClick={clearAll}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 sm:hidden">
          {resultsUsedProfileFallback ? (
            <div className="flex-1 rounded-2xl border border-border/60 bg-warning/15 px-3 py-2 text-xs text-warning">
              No matches for your profile roles. Showing all jobs.
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <div className="inline-flex rounded-full border border-border/60 bg-card/60 p-1 shadow-sm shadow-black/20">
            <button
              type="button"
              onClick={() => setViewMode("detailed")}
              className={[
                "flex items-center justify-center rounded-full px-2 py-1",
                viewMode === "detailed" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              ].join(" ")}
              aria-label="Detailed view"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("compact")}
              className={[
                "flex items-center justify-center rounded-full px-2 py-1",
                viewMode === "compact" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              ].join(" ")}
              aria-label="Compact view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>

        {activeChips.length ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {activeChips.map((c) => (
              <button
                key={`${c.key}:${c.value}`}
                type="button"
                onClick={() => removeChip(c.key)}
                className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs text-foreground/80 hover:bg-accent/60 transition-all duration-200 shadow-sm shadow-black/20"
              >
                <span className="text-muted-foreground font-medium">{c.label}:</span>
                <span className="max-w-[220px] truncate font-medium">{c.value}</span>
                <span className="text-muted-foreground hover:text-foreground">×</span>
              </button>
            ))}
          </div>
        ) : null}

        <div
          className={
            "mt-4 grid min-w-0 grid-cols-1 gap-6 items-start " +
            (session
              ? "lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(240px,320px)]"
              : "lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]")
          }
        >
          <div className="hidden lg:block w-full">
            <div className="sticky top-24">
              <Card>
                <CardBody className="pt-6">{FiltersPanel}</CardBody>
              </Card>
            </div>
          </div>

          <div className="grid min-w-0 gap-3">
            {!session ? (
              <Card className="rounded-2xl border-border/60 bg-gradient-to-br from-panel/60 to-background shadow-sm shadow-black/20">
                <CardBody className="p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-semibold text-foreground">India’s Fastest Growing Logistics Hiring Platform</div>
                      <div className="mt-1 text-sm text-muted-foreground">Create your profile in 60 seconds. Get hired faster.</div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button 
                        variant="secondary" 
                        className="rounded-xl font-medium"
                        onClick={() => openAuth("login")}
                      >
                        Log in
                      </Button>
                      <Button 
                        className="rounded-xl font-medium"
                        onClick={() => openAuth("create")}
                      >
                        Create profile
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ) : null}
            {resultsError ? (
              <Card>
                <CardBody className="pt-6">
                  <div className="grid gap-3">
                    <div className="text-sm font-semibold">Couldn’t load jobs</div>
                    <div className="text-sm text-muted-foreground">{resultsError}</div>
                    <div>
                      <Button variant="secondary" className="rounded-xl" onClick={() => fetchJobsPage()}>
                        Retry
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ) : null}

            {resultsLoading && !resultsLoadedOnce ? (
              <div className="grid gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="overflow-hidden">
                    <CardBody className="pt-6">
                      <div className="grid gap-4 sm:grid-cols-[64px_1fr_auto] sm:items-start">
                        <div className="h-16 w-16 rounded-2xl bg-muted animate-pulse" />
                        <div className="grid gap-3">
                          <div className="h-5 w-2/3 rounded bg-muted animate-pulse" />
                          <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
                          <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
                          <div className="flex gap-2">
                            <div className="h-6 w-20 rounded-full bg-muted animate-pulse" />
                            <div className="h-6 w-24 rounded-full bg-muted animate-pulse" />
                            <div className="h-6 w-16 rounded-full bg-muted animate-pulse" />
                          </div>
                        </div>
                        <div className="h-9 w-24 rounded-xl bg-muted animate-pulse" />
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            ) : !resultsJobs.length ? (
              <Card className="rounded-2xl border-border/60 bg-panel/40">
                <CardBody className="py-16 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/60 text-muted-foreground">
                      <Search className="h-8 w-8" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-lg font-semibold text-foreground">No jobs found</h3>
                      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                        We couldn&apos;t find any jobs matching your current filters. Try adjusting your search criteria.
                      </p>
                    </div>
                    {activeChips.length > 0 && (
                      <Button 
                        variant="secondary" 
                        onClick={clearAll}
                        className="mt-2 rounded-xl"
                      >
                        Clear all filters
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            ) : (
              <>
              {resultsJobs.map((job: Job) => {
                const client = (job as any).client_id ? resultsClientsById[String((job as any).client_id)] : null
                const companyName = client?.name || (job as any).client_name || "Company"
                const logoUrl = client?.logo_url || (job as any).company_logo_url || null
                const companyHref = client?.slug ? `/clients/${client.slug}` : null
                const city = String((job as any).city || "").trim()
                const loc = String(job.location || "").trim()
                const place = [city, loc].filter(Boolean).join(", ") || "India"
                const isExternal = String((job as any).apply_type || "in_platform") === "external"
                const createdAtMs = job.created_at ? new Date(job.created_at).getTime() : 0
                const isNew = Boolean(createdAtMs) && Date.now() - createdAtMs <= 15 * 24 * 60 * 60 * 1000
                const jobHref = embedded ? `/dashboard/jobs/${job.id}` : `/jobs/${job.id}`
                const hasSkills = Boolean((job as any).skills_must_have?.length || (job as any).skills_good_to_have?.length)
                const isApplied = appliedJobIdSet.has(String(job.id))

                const isHighlighted = sp.get("highlightJobId") === String(job.id)
                const isNavigating = navigatingJobId === String(job.id)

                return (
                  <Card
                    key={job.id}
                    className={[
                      "group relative overflow-hidden rounded-2xl border bg-card shadow-sm shadow-black/20 transition-colors duration-150 hover:bg-card/90 hover:shadow-md hover:shadow-black/30 cursor-pointer",
                      isHighlighted ? "border-primary ring-2 ring-primary/20" : "border-border/60"
                    ].join(" ")}
                    id={isHighlighted ? `job-${job.id}` : undefined}
                    onClick={() => {
                      try {
                        window.sessionStorage.setItem(scrollKey, String(window.scrollY || 0))
                      } catch {}
                      setNavigatingJobId(String(job.id))
                      router.push(jobHref)
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-success/10 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                    <CardBody className="relative p-5">
                      <div className="flex items-start gap-4">
                        <div className="relative flex-shrink-0">
                          {companyHref ? (
                            <Link 
                              href={companyHref} 
                              className="inline-flex z-10 relative"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {logoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={logoUrl} alt={companyName} className="h-14 w-14 rounded-xl border border-border/60 bg-card object-contain p-2 shadow-sm shadow-black/20 transition-transform duration-300 group-hover:scale-105" />
                              ) : (
                                <div className="h-14 w-14 rounded-xl border border-border/60 bg-accent/60 flex items-center justify-center text-muted-foreground shadow-sm shadow-black/20">
                                  <Building2 className="h-5 w-5" />
                                </div>
                              )}
                            </Link>
                          ) : logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={logoUrl} alt={companyName} className="h-14 w-14 rounded-xl border border-border/60 bg-card object-contain p-2 shadow-sm shadow-black/20 transition-transform duration-300 group-hover:scale-105" />
                          ) : (
                            <div className="h-14 w-14 rounded-xl border border-border/60 bg-accent/60 flex items-center justify-center text-muted-foreground shadow-sm shadow-black/20">
                              <Building2 className="h-5 w-5" />
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="block text-lg font-semibold leading-tight text-foreground hover:text-primary transition-colors duration-200">
                                {job.title}
                              </div>
                              {companyHref ? (
                                <Link
                                  href={companyHref}
                                  className="mt-1 block text-sm font-medium text-muted-foreground hover:text-foreground transition-colors duration-200 truncate z-10 relative"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {companyName}
                                </Link>
                              ) : (
                                <div className="mt-1 text-sm font-medium text-muted-foreground truncate">{companyName}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                              <span>{formatRelativeTime(job.created_at)}</span>
                              {isApplied ? (
                                <Badge className="bg-accent/60 text-foreground/90 text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm shadow-black/20">
                                  Applied
                                </Badge>
                              ) : null}
                              {isNew ? (
                                <Badge className="bg-primary text-primary-foreground text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm shadow-black/20">
                                  New
                                </Badge>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                            <span className="inline-flex items-center gap-2 text-muted-foreground">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate font-medium">{place}</span>
                            </span>
                            <span className="inline-flex items-center gap-2 text-muted-foreground">
                              <Briefcase className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{(job as any).employment_type ? formatEnum((job as any).employment_type) : "Job"}</span>
                            </span>
                            <span className="font-semibold text-foreground">{formatSalary(job)}</span>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {(job as any).shift_type && (
                              <Badge className="bg-accent/60 text-foreground/80 border-border/60 font-medium">
                                {formatEnum((job as any).shift_type)}
                              </Badge>
                            )}
                            {(job as any).department_category && (
                              <Badge className="bg-accent/60 text-foreground/80 border-border/60 font-medium">
                                {formatEnum((job as any).department_category)}
                              </Badge>
                            )}
                            {isExternal ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  startExternalApply(job)
                                }}
                                className="inline-flex"
                              >
                                <Badge className="bg-success/15 text-success border-border/60 font-medium">
                                  Company site
                                </Badge>
                              </button>
                            ) : (
                              <Badge className="bg-primary/15 text-primary border-border/60 font-medium">
                                Easy apply
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              {(job as any).view_count ? (
                                <span className="text-muted-foreground font-medium">{(job as any).view_count} views</span>
                              ) : null}
                              {hasSkills ? <span className="text-xs font-medium text-muted-foreground">Skills:</span> : null}
                              {viewMode === "detailed"
                                ? (job as any).skills_must_have?.slice(0, 2).map((skill: string) => (
                                <button
                                  key={skill}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    try {
                                      window.sessionStorage.setItem(scrollKey, String(window.scrollY || 0))
                                    } catch {}
                                    setNavigatingJobId(String(job.id))
                                    router.push(jobHref)
                                  }}
                                  className="inline-flex items-center rounded-full border border-border/60 bg-success/15 px-2 py-1 text-xs font-medium text-success hover:bg-success/20 transition-colors duration-200"
                                >
                                  {skill}
                                </button>
                              ))
                                : null}
                              {viewMode === "detailed"
                                ? (job as any).skills_good_to_have?.slice(0, 1).map((skill: string) => (
                                <button
                                  key={skill}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    try {
                                      window.sessionStorage.setItem(scrollKey, String(window.scrollY || 0))
                                    } catch {}
                                    setNavigatingJobId(String(job.id))
                                    router.push(jobHref)
                                  }}
                                  className="inline-flex items-center rounded-full border border-border/60 bg-accent/60 px-2 py-1 text-xs font-medium text-foreground/80 hover:bg-accent/80 transition-colors duration-200"
                                >
                                  {skill}
                                </button>
                              ))
                                : null}
                              {viewMode === "detailed" &&
                                ((job as any).skills_must_have?.length > 2 || (job as any).skills_good_to_have?.length > 1) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    try {
                                      window.sessionStorage.setItem(scrollKey, String(window.scrollY || 0))
                                    } catch {}
                                    setNavigatingJobId(String(job.id))
                                    router.push(jobHref)
                                  }}
                                  className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors duration-200"
                                >
                                  +{Math.max(
                                    0,
                                    ((job as any).skills_must_have?.length - 2 || 0) + ((job as any).skills_good_to_have?.length - 1 || 0)
                                  )}{" "}
                                  more
                                </button>
                              )}
                            </div>
                            <Link
                              href={jobHref}
                              onClick={(e) => {
                                e.stopPropagation()
                                try {
                                  window.sessionStorage.setItem(scrollKey, String(window.scrollY || 0))
                                } catch {}
                                setNavigatingJobId(String(job.id))
                              }}
                              className="inline-flex"
                            >
                              <Button
                                variant="secondary"
                                size="sm"
                                className={[
                                  "rounded-full transition-all duration-200 group-hover:shadow-md h-9 px-4 text-xs",
                                  isApplied
                                    ? "bg-accent/60 text-foreground hover:bg-accent/80"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90",
                                  isNavigating ? "opacity-70 cursor-wait" : ""
                                ].join(" ")}
                              >
                                {isNavigating ? "Opening…" : isApplied ? "View applied" : "View"}
                                <ArrowRight className="ml-1 h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                              </Button>
                            </Link>
                          </div>
                    </CardBody>
                  </Card>
                )
              })}
              <div className="pt-6">
                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="secondary"
                    className="rounded-xl"
                    disabled={resultsLoading || appliedPage <= 1}
                    onClick={() => {
                      const next = new URLSearchParams(sp.toString())
                      next.set("page", String(Math.max(1, appliedPage - 1)))
                      router.push(`${pathname}?${next.toString()}`)
                      window.scrollTo({ top: 0, behavior: "smooth" })
                    }}
                  >
                    Previous
                  </Button>
                  <div className="text-sm font-medium text-muted-foreground bg-accent/60 rounded-lg px-3 py-1.5">
                    Page {appliedPage}
                  </div>
                  <Button
                    variant="secondary"
                    className="rounded-xl"
                    disabled={resultsLoading || !resultsHasMore}
                    onClick={() => {
                      const next = new URLSearchParams(sp.toString())
                      next.set("page", String(appliedPage + 1))
                      router.push(`${pathname}?${next.toString()}`)
                      window.scrollTo({ top: 0, behavior: "smooth" })
                    }}
                  >
                    Next
                  </Button>
                </div>
                <div className="mt-3 text-center text-xs text-muted-foreground font-medium">15 jobs per page</div>
              </div>
              </>
            )}
          </div>

          {session ? (
          <div className="grid gap-4 w-full min-w-0 justify-self-end">
            <div className="sticky top-24">
              <Card className="rounded-2xl border-border/60 bg-card/60 backdrop-blur-sm shadow-sm shadow-black/20">
                <CardBody className="p-6">
                  {session ? (
                    <div className="grid gap-4">
                      <div className="flex items-center gap-4">
                        <div className="relative h-12 w-12 overflow-hidden rounded-full border border-border/60 shadow-lg shadow-black/30">
                          {candidateAvatarUrl || googleAvatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={candidateAvatarUrl || googleAvatarUrl}
                              alt={candidate?.name || "Profile"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="h-full w-full bg-gradient-to-br from-accent/60 to-card flex items-center justify-center font-semibold text-muted-foreground">
                              {String(candidate?.name || "U").trim().slice(0, 1).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-foreground truncate">{candidate?.name || "Your profile"}</div>
                          <div className="text-sm text-muted-foreground truncate">{candidate?.email || ""}</div>
                        </div>
                      </div>
                      <Link href="/dashboard/profile" className="w-full">
                        <Button 
                          variant="secondary" 
                          className="w-full rounded-xl font-medium"
                        >
                          Update profile
                        </Button>
                      </Link>
                      {candidateLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <div className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-pulse" />
                          Loading profile…
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      <div className="rounded-xl bg-gradient-to-br from-panel/60 to-card border border-border/60 p-4">
                        <div className="font-semibold text-foreground">India’s Fastest Growing Logistics Hiring Platform</div>
                        <div className="mt-1 text-sm text-muted-foreground">Create your profile in 60 seconds. Get hired faster.</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button 
                          variant="secondary" 
                          className="w-full rounded-xl font-medium"
                          onClick={() => openAuth("login")}
                        >
                          Log in
                        </Button>
                        <Button 
                          className="w-full rounded-xl font-medium"
                          onClick={() => openAuth("create")}
                        >
                          Create profile
                        </Button>
                      </div>
                      {sessionLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <div className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-pulse" />
                          Checking session…
                        </div>
                      ) : null}
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card className="mt-4">
                <CardBody className="pt-6">
                  <div className="grid gap-3">
                    <div className="text-sm font-semibold">Sort by</div>
                    <select
                      value={draftSort}
                      onChange={(e) => applySort(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                    >
                      <option value="relevant">Relevant</option>
                      <option value="recent">Most recent</option>
                    </select>

                    {roleBoostTerms.length ? (
                      <div className="rounded-2xl border bg-background px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                          <div className="text-sm font-semibold">Filter jobs using your profile</div>
                          <div className="text-xs text-muted-foreground">Based on your preferred title/role</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => (profileRoleFilterOn ? disableProfileRoleFilter() : enableProfileRoleFilter())}
                            className={
                              "inline-flex h-8 w-14 items-center rounded-full border px-1 transition-colors " +
                              (profileRoleFilterOn ? "bg-primary border-primary" : "bg-muted border-input")
                            }
                            aria-label="Toggle profile role filtering"
                          >
                            <span
                              className={
                                "h-6 w-6 rounded-full bg-background shadow transition-transform " +
                                (profileRoleFilterOn ? "translate-x-6" : "translate-x-0")
                              }
                            />
                          </button>
                        </div>
                      </div>
                    ) : null}

                  {resultsUsedProfileFallback ? (
                    <div className="hidden md:block rounded-2xl border border-border/60 bg-warning/15 px-4 py-3 text-sm text-warning">
                      No matches for your profile roles. Showing all jobs.
                    </div>
                  ) : null}
                  </div>
                </CardBody>
              </Card>

              <div ref={profileRef} className="mt-4" />

              <Card className="mt-4">
                <CardBody className="pt-6">
                  <div className="grid gap-3">
                    <div>
                      <div className="font-semibold">Edit your preferences</div>
                      <div className="text-xs text-muted-foreground break-words">Your job feed is shown based on these preferences</div>
                    </div>

                    {prefsError ? <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">{prefsError}</div> : null}

                    <div className="grid gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">Preferred title/role</div>
                        <button
                          type="button"
                          onClick={() => {
                            if (!session || prefsBusy) return
                            openRoleModal()
                          }}
                          className="text-sm font-semibold text-primary"
                        >
                          Edit
                        </button>
                      </div>

                      {explicitPreferredRoles.length || desiredRole ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!session || prefsBusy) return
                            openRoleModal()
                          }}
                          className="flex flex-wrap gap-2 text-left"
                        >
                          {explicitPreferredRoles.map((r) => (
                            <span key={r} className="rounded-full border bg-background px-3 py-1.5 text-xs">
                              {r}
                            </span>
                          ))}
                          {desiredRole && !explicitPreferredRoles.includes(desiredRole) ? (
                            <span className="rounded-full border bg-primary/10 px-3 py-1.5 text-xs">
                              {desiredRole}
                            </span>
                          ) : null}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (!session || prefsBusy) return
                            openRoleModal()
                          }}
                          className="w-full rounded-2xl border border-dashed bg-background px-4 py-3 text-left text-sm text-muted-foreground"
                        >
                          Add your preferred role titles
                        </button>
                      )}
                    </div>

                    <div className="grid gap-2">
                      <div className="text-sm font-medium">Job preferences</div>
                      <div className="grid gap-2">
                        {[
                          { id: "full_time", label: "Full time" },
                          { id: "part_time", label: "Part time" },
                          { id: "contract", label: "Contract" }
                        ].map((opt) => {
                          const checked = preferredJobTypes.includes(opt.id)
                          return (
                            <label key={opt.id} className="flex items-center justify-between rounded-2xl border bg-background px-4 py-3 text-sm shadow-sm">
                              <span>{opt.label}</span>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleJobType(opt.id)}
                                disabled={!session || prefsBusy}
                                className="h-4 w-4"
                              />
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          </div>
          ) : null}
        </div>

        <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" variant="sheet">
          <div className="md:hidden">{MobileFiltersPanel}</div>
          <div className="hidden md:block">{FiltersPanel}</div>
        </Modal>

        <Modal open={sortModalOpen} onClose={() => setSortModalOpen(false)} title="Sort jobs" size="sm" variant="sheet">
          <div className="grid gap-3">
            <div className="text-sm text-muted-foreground mb-2">Sort by</div>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => {
                  applySort("recent")
                  setSortModalOpen(false)
                }}
                className={`flex items-center justify-between rounded-xl border border-border/60 px-4 py-3 text-left transition-colors ${
                  draftSort === "recent" 
                    ? "bg-primary/15 text-primary" 
                    : "bg-card/60 hover:bg-accent/60 text-foreground"
                }`}
              >
                <div>
                  <div className="font-medium">Most recent</div>
                  <div className="text-sm text-muted-foreground">Newest jobs first</div>
                </div>
                {draftSort === "recent" && (
                  <div className="h-2 w-2 rounded-full bg-primary" />
                )}
              </button>
              
              <button
                type="button"
                onClick={() => {
                  applySort("relevant")
                  setSortModalOpen(false)
                }}
                className={`flex items-center justify-between rounded-xl border border-border/60 px-4 py-3 text-left transition-colors ${
                  draftSort === "relevant" 
                    ? "bg-primary/15 text-primary" 
                    : "bg-card/60 hover:bg-accent/60 text-foreground"
                }`}
              >
                <div>
                  <div className="font-medium">Most relevant</div>
                  <div className="text-sm text-muted-foreground">Based on your profile</div>
                </div>
                {draftSort === "relevant" && (
                  <div className="h-2 w-2 rounded-full bg-primary" />
                )}
              </button>
            </div>
            
            {session && (
              <div className="mt-4 rounded-xl border border-border/60 bg-card/60 p-3">
                <div className="text-sm font-medium text-foreground mb-1">Profile-based sorting</div>
                <div className="text-xs text-muted-foreground">
                  {draftSort === "relevant" 
                    ? "Showing jobs that match your preferred title/role" 
                    : "Showing all jobs sorted by posting date"}
                </div>
              </div>
            )}
          </div>
        </Modal>

        <Modal open={roleModalOpen} onClose={closeRoleModal} title="Preferred title/role">
          <div className="grid gap-4">
            {roleModalError ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">{roleModalError}</div>
            ) : null}

            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Selected</div>
              {roleModalSelected.length ? (
                <div className="flex flex-wrap gap-2">
                  {roleModalSelected.map((r) => (
                    <button
                      key={`sel:${r}`}
                      type="button"
                      onClick={() => setRoleModalSelected((prev) => prev.filter((x) => x !== r))}
                      className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs hover:bg-accent"
                      disabled={prefsBusy}
                      title="Remove"
                    >
                      <span className="max-w-[220px] truncate">{r}</span>
                      <span className="text-muted-foreground">×</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed bg-background px-4 py-3 text-sm text-muted-foreground">
                  Select one or more roles
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Add role</div>
              <div className="flex gap-2">
                <Input
                  value={roleModalQuery}
                  onChange={(e) => setRoleModalQuery(e.target.value)}
                  placeholder="Type a role (e.g. Fleet Manager)"
                  disabled={prefsBusy}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return
                    e.preventDefault()
                    const v = roleModalQuery.trim()
                    if (!v) return
                    setRoleModalSelected((prev) => Array.from(new Set([...prev, v])).slice(0, 12))
                    setRoleModalQuery("")
                  }}
                />
                <Button
                  variant="secondary"
                  className="rounded-xl"
                  disabled={prefsBusy || !roleModalQuery.trim()}
                  onClick={() => {
                    const v = roleModalQuery.trim()
                    if (!v) return
                    setRoleModalSelected((prev) => Array.from(new Set([...prev, v])).slice(0, 12))
                    setRoleModalQuery("")
                  }}
                >
                  Add
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">AI suggestions (from your profile)</div>
                {roleModalBusy ? <div className="text-xs text-muted-foreground">Generating…</div> : null}
              </div>
              {roleModalBusy ? (
                <div className="rounded-2xl border border-border/60 bg-primary/10 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="h-9 rounded-full bg-primary/15 animate-pulse" />
                    ))}
                  </div>
                </div>
              ) : roleModalSuggestions.length ? (
                <div className="flex flex-wrap gap-2">
                  {roleModalSuggestions
                    .filter((x) => (roleModalQuery ? x.toLowerCase().includes(roleModalQuery.toLowerCase()) : true))
                    .slice(0, 24)
                    .map((opt) => {
                      const active = roleModalSelected.includes(opt)
                      return (
                        <button
                          key={`s:${opt}`}
                          type="button"
                          onClick={() => {
                            setRoleModalSelected((prev) => {
                              const set = new Set(prev)
                              if (set.has(opt)) set.delete(opt)
                              else set.add(opt)
                              return Array.from(set).slice(0, 12)
                            })
                          }}
                          className={
                            "rounded-full border px-3 py-1.5 text-xs " +
                            (active ? "bg-primary/15 text-primary border-border/60" : "bg-background text-muted-foreground hover:bg-accent")
                          }
                          disabled={prefsBusy}
                        >
                          {opt}
                        </button>
                      )
                    })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed bg-background px-4 py-3 text-sm text-muted-foreground">
                  No AI suggestions yet. Type your role above and press Enter.
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                variant="secondary"
                className="rounded-xl"
                onClick={() => setRoleModalSelected([])}
                disabled={prefsBusy}
              >
                Clear
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" className="rounded-xl" onClick={closeRoleModal} disabled={prefsBusy}>
                  Cancel
                </Button>
                <Button className="rounded-xl" onClick={applyRoleModal} disabled={prefsBusy}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </Modal>

        <AuthModal open={authOpen} onClose={closeAuth} defaultMode={authMode === "login" ? "login" : "signup"} />
        
        <Modal open={!!didYouApplyJob} onClose={() => setDidYouApplyJob(null)} title="Did you apply?">
          <div className="grid gap-4">
             <p className="text-sm text-muted-foreground">
               You were redirected to the company&apos;s website to apply for <strong>{didYouApplyJob?.title}</strong>.
               Did you complete the application?
             </p>
             <div className="flex gap-3 justify-end">
                <Button variant="secondary" onClick={() => handleDidYouApply(false)} disabled={didYouApplyBusy} className="rounded-xl">No, I didn&apos;t</Button>
                <Button onClick={() => handleDidYouApply(true)} disabled={didYouApplyBusy} className="rounded-xl">Yes, I applied</Button>
             </div>
          </div>
        </Modal>
        </div>
      </main>
    </div>
  )
}
