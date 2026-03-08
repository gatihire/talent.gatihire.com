"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import type { Candidate } from "@/lib/types"
import { bearerHeaders } from "@/lib/http"
import { tagsToMap, mapToTags } from "@/components/apply/tagUtils"
import { Modal } from "@/components/ui/Modal"
import { Button } from "@/components/ui/Button"
import { Input, Textarea } from "@/components/ui/Input"
import { Badge } from "@/components/ui/Badge"
import { WorkAvailabilityModal } from "@/components/dashboard/WorkAvailabilityModal"
import { CalendarDays, Camera, ExternalLink, Link2, MapPin, Pencil, Plus, Trash2 } from "lucide-react"

type CandidateLike = Omit<Candidate, "email" | "phone"> & {
  email?: string
  phone?: string | null
}

const LOCATION_PRESETS = [
  "Anywhere in India",
  "Delhi NCR",
  "Mumbai",
  "Bengaluru",
  "Hyderabad",
  "Chennai",
  "Pune",
  "Ahmedabad",
  "Kolkata",
  "Jaipur",
  "Surat",
  "Indore",
  "Lucknow"
]

function splitLocations(raw: string) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    )
  ).slice(0, 8)
}

function initialsFromName(name: string) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean)
  const a = (parts[0]?.[0] || "U").toUpperCase()
  const b = (parts[1]?.[0] || "").toUpperCase()
  return `${a}${b}`.slice(0, 2)
}

function splitSkills(value: string) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean)
}

function uniq(values: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

function normalizeExternalUrl(raw: string) {
  if (!raw) return ""
  const trimmed = raw.trim()
  if (!trimmed) return ""
  try {
    const url = new URL(trimmed)
    return url.href
  } catch {
    // fallback: prepend https:// if no protocol
    return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`
  }
}

function isValidEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim() : ""
  if (!email) return false
  return /^\S+@\S+\.\S+$/.test(email)
}

type ProjectItem = {
  id: string
  title: string
  description?: string
  link?: string
  role?: string
  technologies?: string[]
}

function parseProjectItems(value: unknown): ProjectItem[] {
  if (!Array.isArray(value)) return []

  const out: ProjectItem[] = []
  for (const it of value) {
    if (typeof it === "string") {
      const title = it.trim()
      if (!title) continue
      out.push({ id: `${title}-${out.length}`, title })
      continue
    }
    if (it && typeof it === "object") {
      const anyIt = it as any
      const title = typeof anyIt.title === "string" ? anyIt.title.trim() : ""
      if (!title) continue
      const id = typeof anyIt.id === "string" && anyIt.id ? anyIt.id : `${title}-${out.length}`
      out.push({
        id,
        title,
        description: typeof anyIt.description === "string" ? anyIt.description : undefined,
        link: typeof anyIt.link === "string" ? anyIt.link : undefined,
        role: typeof anyIt.role === "string" ? anyIt.role : undefined,
        technologies: Array.isArray(anyIt.technologies)
          ? anyIt.technologies.filter((x: any) => typeof x === "string").map((x: string) => x.trim()).filter(Boolean)
          : undefined
      })
    }
  }
  return out
}

function serializeProjectItems(items: ProjectItem[]) {
  return items
    .map((it) => ({
      id: it.id,
      title: it.title,
      description: it.description || null,
      link: it.link || null,
      role: it.role || null,
      technologies: it.technologies || []
    }))
    .filter((it) => typeof it.title === "string" && it.title.trim())
}

export function ProfileBraintrust({
  accessToken,
  candidate,
  onCandidateUpdated,
  googleAvatarUrl,
  mode = "private",
  initialWorkItems,
  initialEducationItems
}: {
  accessToken?: string
  candidate: CandidateLike
  onCandidateUpdated: (c: CandidateLike) => void
  googleAvatarUrl?: string
  mode?: "private" | "public"
  initialWorkItems?: any[]
  initialEducationItems?: any[]
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const readonly = mode === "public"
  const canEdit = !readonly && Boolean(accessToken)
  const [tab, setTab] = useState<"about" | "resume">("about")
  const [availabilityOpen, setAvailabilityOpen] = useState(false)

  const [origin, setOrigin] = useState("")
  const [resumeSignedUrl, setResumeSignedUrl] = useState<string | null>(null)
  const [resumeUploading, setResumeUploading] = useState(false)
  const [resumeUploadError, setResumeUploadError] = useState<string | null>(null)
  const showResumeTab = Boolean(candidate.file_url || resumeSignedUrl || canEdit)

  const [bioOpen, setBioOpen] = useState(false)
  const [websitesOpen, setWebsitesOpen] = useState(false)
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [certsOpen, setCertsOpen] = useState(false)

  const [workItems, setWorkItems] = useState<any[]>(Array.isArray(initialWorkItems) ? initialWorkItems : [])
  const [workOpen, setWorkOpen] = useState(false)
  const [workDraft, setWorkDraft] = useState<any>({
    id: null,
    company: "",
    role: "",
    duration: "",
    location: "",
    description: "",
    responsibilities: "",
    achievements: "",
    is_current: false
  })

  const [educationItems, setEducationItems] = useState<any[]>(Array.isArray(initialEducationItems) ? initialEducationItems : [])
  const [educationOpen, setEducationOpen] = useState(false)
  const [educationDraft, setEducationDraft] = useState<any>({
    id: null,
    degree: "",
    institution: "",
    specialization: "",
    year: "",
    percentage: "",
    description: ""
  })

  const preferences = useMemo(() => tagsToMap(candidate.tags), [candidate.tags])
  const profileAvatarUrl = useMemo(() => {
    const v = preferences.avatar_url
    return typeof v === "string" ? v.trim() : ""
  }, [preferences.avatar_url])

  const googleAvatar = useMemo(() => {
    const v = typeof googleAvatarUrl === "string" ? googleAvatarUrl : ""
    return v.trim()
  }, [googleAvatarUrl])

  const avatarUrl = useMemo(() => {
    return profileAvatarUrl || googleAvatar
  }, [profileAvatarUrl, googleAvatar])

  const lastUpdatedLabel = useMemo(() => {
    const raw = (candidate as any)?.updated_at
    if (!raw) return ""
    const d = new Date(String(raw))
    if (Number.isNaN(d.getTime())) return ""
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  }, [candidate])
  const skills = useMemo(() => {
    const tagSkills = splitSkills(preferences.skills || "")
    const technical = asStringArray(candidate.technical_skills)
    const soft = asStringArray(candidate.soft_skills)
    return uniq([...tagSkills, ...technical, ...soft])
  }, [preferences.skills, candidate.technical_skills, candidate.soft_skills])

  const profileStrength = useMemo(() => {
    const checks = [
      Boolean(candidate.summary && String(candidate.summary).trim()),
      Boolean(candidate.current_role && String(candidate.current_role).trim()),
      Boolean(candidate.location && String(candidate.location).trim()),
      Boolean(candidate.total_experience && String(candidate.total_experience).trim()),
      skills.length > 0,
      workItems.length > 0,
      educationItems.length > 0,
      Boolean(candidate.linkedin_profile || candidate.github_profile || candidate.portfolio_url),
      Boolean((candidate as any)?.file_url)
    ]
    const total = checks.length
    const done = checks.filter(Boolean).length
    const pct = total ? Math.round((done / total) * 100) : 0
    const bars = Math.max(0, Math.min(4, Math.round((pct / 100) * 4)))
    return { pct, bars }
  }, [candidate, skills.length, workItems.length, educationItems.length])

  const missingName = !String(candidate.name || "").trim()
  const missingEmail = !isValidEmail(candidate.email)
  const missingPhone = !String(candidate.phone || "").trim()
  const missingLocation = !String(candidate.location || "").trim()
  const missingRole = !String(candidate.current_role || "").trim()
  const missingExperience = !String(candidate.total_experience || "").trim()
  const hasMissingRequired = missingName || missingEmail || missingPhone || missingLocation || missingRole || missingExperience
  const missingRequiredLabels = useMemo(
    () =>
      [
        missingName ? "Full name" : null,
        missingEmail ? "Email" : null,
        missingPhone ? "Phone" : null,
        missingLocation ? "Location" : null,
        missingRole ? "Current role" : null,
        missingExperience ? "Total experience" : null
      ].filter(Boolean) as string[],
    [missingName, missingEmail, missingPhone, missingLocation, missingRole, missingExperience]
  )

  const availabilityJobTypes = useMemo(() => asStringArray(candidate.open_job_types), [candidate.open_job_types])
  const availabilityLocations = useMemo(() => splitLocations(candidate.preferred_location || ""), [candidate.preferred_location])
  const availabilityHours = useMemo(() => {
    if (!candidate.available_start_time || !candidate.available_end_time) return ""
    return `${candidate.available_start_time} – ${candidate.available_end_time}`
  }, [candidate.available_start_time, candidate.available_end_time])
  const availabilityStartLabel = useMemo(() => {
    if (!candidate.available_start_date) return ""
    const d = new Date(candidate.available_start_date)
    if (Number.isNaN(d.getTime())) return ""
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  }, [candidate.available_start_date])
  const showAvailabilityCallout =
    !candidate.looking_for_work ||
    availabilityJobTypes.length === 0 ||
    !candidate.work_timezone ||
    !candidate.available_start_time ||
    !candidate.available_end_time ||
    !candidate.available_start_date ||
    availabilityLocations.length === 0

  const certifications = useMemo(() => asStringArray(candidate.certifications), [candidate.certifications])
  const projectItems = useMemo(() => parseProjectItems(candidate.projects), [candidate.projects])

  const [bioDraft, setBioDraft] = useState({
    name: candidate.name || "",
    email: candidate.email || "",
    phone: candidate.phone || "",
    current_role: candidate.current_role || "",
    current_company: candidate.current_company || "",
    total_experience: candidate.total_experience || "",
    desired_role: candidate.desired_role || "",
    preferred_location: candidate.preferred_location || "",
    current_salary: candidate.current_salary || "",
    expected_salary: candidate.expected_salary || "",
    notice_period: candidate.notice_period || "",
    highest_qualification: candidate.highest_qualification || "",
    degree: candidate.degree || "",
    specialization: candidate.specialization || "",
    university: candidate.university || "",
    summary: candidate.summary || "",
    location: candidate.location || ""
  })

  const [bioLocFocused, setBioLocFocused] = useState(false)
  const [prefLocsDraft, setPrefLocsDraft] = useState<string[]>(splitLocations(candidate.preferred_location || ""))
  const [prefLocInput, setPrefLocInput] = useState("")
  const [prefLocFocused, setPrefLocFocused] = useState(false)
  const [websitesDraft, setWebsitesDraft] = useState({
    linkedin_profile: candidate.linkedin_profile || "",
    portfolio_url: candidate.portfolio_url || "",
    github_profile: candidate.github_profile || ""
  })
  const [skillsDraft, setSkillsDraft] = useState(skills.join(", "))
  const [certsDraft, setCertsDraft] = useState(certifications.join(", "))
  const [projectsList, setProjectsList] = useState<ProjectItem[]>(projectItems)
  const [projectOpen, setProjectOpen] = useState(false)
  const [projectDraft, setProjectDraft] = useState<ProjectItem>({ id: "", title: "", description: "", link: "", role: "", technologies: [] })

  const bioLocTypeahead = useMemo(() => {
    const q = String(bioDraft.location || "").trim().toLowerCase()
    if (!q) return [] as string[]
    return LOCATION_PRESETS.filter((x) => x.toLowerCase().includes(q)).slice(0, 10)
  }, [bioDraft.location])

  const prefLocTypeahead = useMemo(() => {
    const q = prefLocInput.trim().toLowerCase()
    if (!q) return [] as string[]
    const taken = new Set(prefLocsDraft.map((x) => x.toLowerCase()))
    return LOCATION_PRESETS.filter((x) => x.toLowerCase().includes(q) && !taken.has(x.toLowerCase())).slice(0, 10)
  }, [prefLocInput, prefLocsDraft])

  const addPrefLoc = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    setPrefLocsDraft((prev) => Array.from(new Set([...prev, t])).slice(0, 8))
    setPrefLocInput("")
  }

  const removePrefLoc = (v: string) => {
    setPrefLocsDraft((prev) => prev.filter((x) => x !== v))
  }

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    const desired = (sp.get("tab") || "").trim().toLowerCase()
    if (desired === "resume") setTab("resume")
  }, [sp])

  useEffect(() => {
    const fallbackUrl = typeof candidate?.file_url === "string" ? candidate.file_url : ""
    setResumeSignedUrl(fallbackUrl || null)
    if (!accessToken || !candidate?.file_url) return

    let cancelled = false
    fetch("/api/candidate/resume/url", { headers: bearerHeaders(accessToken) })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        const url = typeof d?.signedUrl === "string" ? d.signedUrl : fallbackUrl || null
        setResumeSignedUrl(url)
      })
      .catch(() => {
        if (cancelled) return
        setResumeSignedUrl(fallbackUrl || null)
      })

    return () => {
      cancelled = true
    }
  }, [accessToken, candidate?.file_url])

  const publicProfileUrl = useMemo(() => {
    if (!candidate.public_profile_enabled || !candidate.public_profile_slug || !origin) return null
    return `${origin}/talent/${candidate.public_profile_slug}`
  }, [candidate.public_profile_enabled, candidate.public_profile_slug, origin])

  useEffect(() => {
    if (initialWorkItems) setWorkItems(initialWorkItems)
  }, [initialWorkItems])

  useEffect(() => {
    if (initialEducationItems) setEducationItems(initialEducationItems)
  }, [initialEducationItems])

  useEffect(() => {
    if (!canEdit || !accessToken) return
    // Only fetch if not provided as initial props or if we want to refresh
    if (initialWorkItems === undefined) {
      fetch("/api/candidate/work-history", { headers: bearerHeaders(accessToken) })
        .then((r) => r.json())
        .then((d) => setWorkItems(Array.isArray(d?.items) ? d.items : []))
        .catch(() => setWorkItems([]))
    }
  }, [accessToken, canEdit, initialWorkItems])

  useEffect(() => {
    if (!canEdit || !accessToken) return
    if (initialEducationItems === undefined) {
      fetch("/api/candidate/education", { headers: bearerHeaders(accessToken) })
        .then((r) => r.json())
        .then((d) => setEducationItems(Array.isArray(d?.items) ? d.items : []))
        .catch(() => setEducationItems([]))
    }
  }, [accessToken, canEdit, initialEducationItems])

  useEffect(() => {
    if (!readonly) return
    setWorkItems(Array.isArray(initialWorkItems) ? initialWorkItems : [])
  }, [readonly, initialWorkItems])

  useEffect(() => {
    if (!readonly) return
    setEducationItems(Array.isArray(initialEducationItems) ? initialEducationItems : [])
  }, [readonly, initialEducationItems])

  useEffect(() => {
    setProjectsList(projectItems)
  }, [projectItems])

  const savePatch = async (patch: Record<string, any>) => {
    if (!canEdit || !accessToken) throw new Error("Unauthorized")
    const res = await fetch("/api/candidate/profile", {
      method: "PUT",
      headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify(patch)
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || "Failed to save")
    onCandidateUpdated(data.candidate)
    return data.candidate as CandidateLike
  }

  const primeBioDraft = () => {
    setBioDraft({
      name: candidate.name || "",
      email: candidate.email || "",
      phone: candidate.phone || "",
      current_role: candidate.current_role || "",
      current_company: candidate.current_company || "",
      total_experience: candidate.total_experience || "",
      desired_role: candidate.desired_role || "",
      preferred_location: candidate.preferred_location || "",
      current_salary: candidate.current_salary || "",
      expected_salary: candidate.expected_salary || "",
      notice_period: candidate.notice_period || "",
      highest_qualification: candidate.highest_qualification || "",
      degree: candidate.degree || "",
      specialization: candidate.specialization || "",
      university: candidate.university || "",
      summary: candidate.summary || "",
      location: candidate.location || ""
    })
    setPrefLocsDraft(splitLocations(candidate.preferred_location || ""))
    setPrefLocInput("")
  }

  const openNewWork = () => {
    setWorkDraft({
      id: null,
      company: "",
      role: "",
      duration: "",
      location: "",
      description: "",
      responsibilities: "",
      achievements: "",
      is_current: false
    })
    setWorkOpen(true)
  }

  const openEditWork = (item: any) => {
    setWorkDraft({
      id: item.id,
      company: item.company || "",
      role: item.role || "",
      duration: item.duration || "",
      location: item.location || "",
      description: item.description || "",
      responsibilities: item.responsibilities || "",
      achievements: item.achievements || "",
      is_current: Boolean(item.is_current)
    })
    setWorkOpen(true)
  }

  const saveWork = async () => {
    if (!workDraft.company.trim() || !workDraft.role.trim() || !workDraft.duration.trim()) return

    if (workDraft.id) {
      const res = await fetch(`/api/candidate/work-history/${workDraft.id}`, {
        method: "PUT",
        headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          company: workDraft.company,
          role: workDraft.role,
          duration: workDraft.duration,
          location: workDraft.location || null,
          description: workDraft.description || null,
          responsibilities: workDraft.responsibilities || null,
          achievements: workDraft.achievements || null,
          is_current: Boolean(workDraft.is_current)
        })
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.item) {
        setWorkItems((prev) => prev.map((x) => (x.id === data.item.id ? data.item : x)))
        setWorkOpen(false)
      }
      return
    }

    const res = await fetch("/api/candidate/work-history", {
      method: "POST",
      headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        company: workDraft.company,
        role: workDraft.role,
        duration: workDraft.duration,
        location: workDraft.location || null,
        description: workDraft.description || null,
        responsibilities: workDraft.responsibilities || null,
        achievements: workDraft.achievements || null,
        is_current: Boolean(workDraft.is_current)
      })
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.item) {
      setWorkItems((prev) => [data.item, ...prev])
      setWorkOpen(false)
    }
  }

  const deleteWork = async (id: string) => {
    const res = await fetch(`/api/candidate/work-history/${id}`, { method: "DELETE", headers: bearerHeaders(accessToken) })
    if (res.ok) setWorkItems((prev) => prev.filter((x) => x.id !== id))
  }

  const openNewEducation = () => {
    setEducationDraft({ id: null, degree: "", institution: "", specialization: "", year: "", percentage: "", description: "" })
    setEducationOpen(true)
  }

  const openEditEducation = (item: any) => {
    setEducationDraft({
      id: item.id,
      degree: item.degree || "",
      institution: item.institution || "",
      specialization: item.specialization || "",
      year: item.year || "",
      percentage: item.percentage || "",
      description: item.description || ""
    })
    setEducationOpen(true)
  }

  const saveEducation = async () => {
    if (!educationDraft.degree.trim() || !educationDraft.institution.trim()) return

    if (educationDraft.id) {
      const res = await fetch(`/api/candidate/education/${educationDraft.id}`, {
        method: "PUT",
        headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          degree: educationDraft.degree,
          institution: educationDraft.institution,
          specialization: educationDraft.specialization || null,
          year: educationDraft.year || null,
          percentage: educationDraft.percentage || null,
          description: educationDraft.description || null
        })
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.item) {
        setEducationItems((prev) => prev.map((x) => (x.id === data.item.id ? data.item : x)))
        setEducationOpen(false)
      }
      return
    }

    const res = await fetch("/api/candidate/education", {
      method: "POST",
      headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        degree: educationDraft.degree,
        institution: educationDraft.institution,
        specialization: educationDraft.specialization || null,
        year: educationDraft.year || null,
        percentage: educationDraft.percentage || null,
        description: educationDraft.description || null
      })
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.item) {
      setEducationItems((prev) => [data.item, ...prev])
      setEducationOpen(false)
    }
  }

  const deleteEducation = async (id: string) => {
    const res = await fetch(`/api/candidate/education/${id}`, { method: "DELETE", headers: bearerHeaders(accessToken) })
    if (res.ok) setEducationItems((prev) => prev.filter((x) => x.id !== id))
  }

  const uploadResume = async (file: File) => {
    if (!accessToken) return
    setResumeUploading(true)
    setResumeUploadError(null)
    try {
      const fd = new FormData()
      fd.append("resume", file)
      const res = await fetch("/api/candidate/resume/parse", {
        method: "POST",
        headers: bearerHeaders(accessToken),
        body: fd
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const msg = String(data?.error || "Failed to upload")
        setResumeUploadError(msg)
        throw new Error(msg)
      }
      if (data?.candidate) onCandidateUpdated(data.candidate)
      router.push(`/onboarding?returnTo=${encodeURIComponent("/dashboard/profile?tab=resume")}`)
    } finally {
      setResumeUploading(false)
    }
  }

  const uploadAvatar = async (file: File) => {
    const fd = new FormData()
    fd.append("avatar", file)
    const res = await fetch("/api/candidate/avatar", {
      method: "POST",
      headers: bearerHeaders(accessToken),
      body: fd
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || "Failed to upload")
    if (data?.candidate) onCandidateUpdated(data.candidate)
  }

  return (
    <div className="grid gap-6">
      <div className="sticky top-16 z-30 -m-6 mb-0 border-b bg-background/90 px-6 py-6 backdrop-blur-md sm:static sm:top-auto sm:m-0 sm:mb-6 sm:rounded-3xl sm:border sm:bg-card sm:p-0 sm:overflow-hidden sm:backdrop-blur-none">
        <div className="hidden h-40 bg-gradient-to-r from-panel via-card to-background sm:block" />

        <div className="pb-0 sm:px-6 sm:pb-6">
          <div className="relative z-10 flex flex-col gap-4 sm:-mt-12 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-center gap-4 sm:items-end">
              <div className="relative shrink-0">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border bg-background text-base font-semibold sm:h-20 sm:w-20 sm:text-lg">
                  {avatarUrl ? (
                    <Image src={avatarUrl} alt={candidate.name} width={80} height={80} className="h-full w-full object-cover" unoptimized />
                  ) : (
                    initialsFromName(candidate.name)
                  )}
                </div>
                {canEdit ? (
                  <button
                    className="absolute -right-1 -top-1 flex h-8 w-8 items-center justify-center rounded-full border bg-card hover:bg-accent"
                    onClick={() => {
                      primeBioDraft()
                      setBioOpen(true)
                    }}
                    aria-label="Edit profile"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                ) : null}

                {canEdit ? (
                  <label className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-foreground text-background sm:h-9 sm:w-9">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) uploadAvatar(f)
                      }}
                    />
                    <Camera className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </label>
                ) : null}
              </div>

              <div className="min-w-0 flex-1 sm:rounded-2xl sm:bg-card/85 sm:px-3 sm:py-2 sm:backdrop-blur">
                <div className="flex items-center gap-2">
                  <div className="truncate text-xl font-semibold tracking-tight sm:text-3xl">{candidate.name}</div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:mt-2 sm:text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    {candidate.location}
                  </span>
                  {candidate.current_role ? <span className="hidden sm:inline">• {candidate.current_role}</span> : null}
                  {lastUpdatedLabel ? <span className="hidden lg:inline">• Updated {lastUpdatedLabel}</span> : null}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 sm:mb-2">
              {canEdit ? (
                <>
                  <Button variant={showAvailabilityCallout ? "danger" : "secondary"} onClick={() => setAvailabilityOpen(true)}>
                    Set work availability
                  </Button>
                  {publicProfileUrl ? (
                    <a href={publicProfileUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="secondary">
                        View public profile <ExternalLink className="ml-2 h-4 w-4" />
                      </Button>
                    </a>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        await savePatch({ public_profile_enabled: true })
                      }}
                    >
                      Enable public profile
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setWebsitesDraft({ linkedin_profile: candidate.linkedin_profile || "", portfolio_url: candidate.portfolio_url || "", github_profile: candidate.github_profile || "" })
                      setWebsitesOpen(true)
                    }}
                  >
                    <Link2 className="mr-2 h-4 w-4" />
                    Add websites
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex gap-6 border-b sm:mt-6">
            <button
              className={[
                "pb-3 text-sm font-medium",
                tab === "about" ? "border-b-2 border-foreground text-foreground" : "text-muted-foreground"
              ].join(" ")}
              onClick={() => setTab("about")}
            >
              About
            </button>
            {showResumeTab ? (
              <button
                className={[
                  "pb-3 text-sm font-medium",
                  tab === "resume" ? "border-b-2 border-foreground text-foreground" : "text-muted-foreground"
                ].join(" ")}
                onClick={() => setTab("resume")}
              >
                Resume
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {tab === "about" ? (
        <div className="grid gap-6">
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="rounded-3xl border border-border/60 bg-card/60 p-6">
                <div className="text-base font-semibold">Add your headline and bio</div>
                <div className="mt-1 text-sm text-muted-foreground">Share more about yourself and what you hope to accomplish.</div>
                <div className="mt-4">
                  {candidate.summary ? (
                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{candidate.summary}</div>
                  ) : canEdit ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        primeBioDraft()
                        setBioOpen(true)
                      }}
                    >
                      Add bio
                    </Button>
                  ) : (
                    <div className="text-sm text-muted-foreground">No bio added yet.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="rounded-3xl border bg-card p-4 shadow-sm sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold">{candidate.total_experience} experience</div>
                    <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                      <CalendarDays className="h-4 w-4" />
                      {candidate.current_role}
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">Profile strength: {profileStrength.pct}%</div>
                  </div>
                  {canEdit ? (
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-full border bg-card hover:bg-accent"
                      onClick={() => {
                        primeBioDraft()
                        setBioOpen(true)
                      }}
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                <div className="mt-6 flex items-center gap-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className={"h-8 w-8 rounded-xl " + (i < profileStrength.bars ? "bg-primary" : "bg-muted")} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-12">
              <div className="rounded-3xl border bg-card p-4 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold">Profile details</div>
                    <div className="mt-1 text-sm text-muted-foreground">Make your profile complete for better matching.</div>
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-2">
                      <button
                        className="flex h-9 w-9 items-center justify-center rounded-full border bg-card hover:bg-accent"
                        onClick={() => {
                          primeBioDraft()
                          setBioOpen(true)
                        }}
                        aria-label="Edit details"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="flex h-9 w-9 items-center justify-center rounded-full border bg-card hover:bg-accent"
                        onClick={() => {
                          setWebsitesDraft({ linkedin_profile: candidate.linkedin_profile || "", portfolio_url: candidate.portfolio_url || "", github_profile: candidate.github_profile || "" })
                          setWebsitesOpen(true)
                        }}
                        aria-label="Edit links"
                      >
                        <Link2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </div>

                {hasMissingRequired ? (
                  <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                    <div className="font-medium">Complete required details</div>
                    <div className="mt-1 text-xs text-destructive/80">
                      Missing: {missingRequiredLabels.join(", ")}
                    </div>
                    {canEdit ? (
                      <div className="mt-3">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            primeBioDraft()
                            setBioOpen(true)
                          }}
                        >
                          Complete now
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {canEdit ? (
                    <div
                      className={[
                        "rounded-3xl border bg-background p-5",
                        hasMissingRequired ? "border-destructive/30 bg-destructive/10" : ""
                      ].join(" ")}
                    >
                      <div className="text-xs font-medium text-muted-foreground">Required details</div>
                      <div className="mt-3 grid gap-1 text-sm">
                        <div className={missingName ? "text-destructive font-medium" : ""}>{candidate.name || "Add full name"}</div>
                        <div className={missingEmail ? "text-destructive font-medium" : "text-muted-foreground"}>
                          {candidate.email || "Add email"}
                        </div>
                        <div className={missingPhone ? "text-destructive font-medium" : "text-muted-foreground"}>
                          {candidate.phone || "Add phone"}
                        </div>
                        <div className={missingLocation ? "text-destructive font-medium" : "text-muted-foreground"}>
                          {candidate.location || "Add location"}
                        </div>
                        <div className={missingRole ? "text-destructive font-medium" : "text-muted-foreground"}>
                          {candidate.current_role || "Add current role"}
                        </div>
                        <div className={missingExperience ? "text-destructive font-medium" : "text-muted-foreground"}>
                          {candidate.total_experience || "Add total experience"}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-3xl border bg-background p-5">
                    <div className="text-xs font-medium text-muted-foreground">Preferences</div>
                    <div className="mt-3 grid gap-1 text-sm">
                      <div>{candidate.desired_role || (canEdit ? "Add desired role" : "Not provided")}</div>
                      <div className="text-muted-foreground">{candidate.preferred_location || (canEdit ? "Add preferred location" : "Not provided")}</div>
                      {candidate.current_company ? <div className="text-muted-foreground">{candidate.current_company}</div> : null}
                      {candidate.notice_period ? <div className="text-muted-foreground">Notice: {candidate.notice_period}</div> : null}
                    </div>
                  </div>
                  <div className="rounded-3xl border bg-background p-5">
                    <div className="text-xs font-medium text-muted-foreground">Links</div>
                    <div className="mt-3 grid gap-2 text-sm">
                      {candidate.linkedin_profile ? (
                        <a className="text-primary hover:underline" href={normalizeExternalUrl(candidate.linkedin_profile)} target="_blank" rel="noopener noreferrer">
                          LinkedIn
                        </a>
                      ) : (
                        <div className="text-muted-foreground">{canEdit ? "Add LinkedIn" : "Not provided"}</div>
                      )}
                      {candidate.portfolio_url ? (
                        <a className="text-primary hover:underline" href={normalizeExternalUrl(candidate.portfolio_url)} target="_blank" rel="noopener noreferrer">
                          Portfolio
                        </a>
                      ) : (
                        <div className="text-muted-foreground">{canEdit ? "Add portfolio" : "Not provided"}</div>
                      )}
                      {candidate.github_profile ? (
                        <a className="text-primary hover:underline" href={normalizeExternalUrl(candidate.github_profile)} target="_blank" rel="noopener noreferrer">
                          GitHub
                        </a>
                      ) : (
                        <div className="text-muted-foreground">{canEdit ? "Add GitHub" : "Not provided"}</div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-3xl border bg-background p-5">
                    <div className="text-xs font-medium text-muted-foreground">Education</div>
                    <div className="mt-3 grid gap-1 text-sm">
                      <div>{candidate.highest_qualification || "Add qualification"}</div>
                      <div className="text-muted-foreground">{candidate.degree || "Add degree"}</div>
                      {candidate.specialization ? <div className="text-muted-foreground">{candidate.specialization}</div> : null}
                      {candidate.university ? <div className="text-muted-foreground">{candidate.university}</div> : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border bg-card p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">Work availability</div>
                <div className="mt-1 text-sm text-muted-foreground">Keep this updated for better job matching.</div>
              </div>
              {canEdit ? (
                <Button variant="secondary" size="sm" onClick={() => setAvailabilityOpen(true)}>
                  Edit availability
                </Button>
              ) : null}
            </div>
            {showAvailabilityCallout ? (
              <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
                <div className="text-sm font-semibold text-destructive">Finish your availability</div>
                <div className="mt-1 text-xs text-destructive/80">Add start date, hours, job types, and locations to be discoverable.</div>
                {canEdit ? (
                  <div className="mt-3">
                    <Button variant="danger" size="sm" onClick={() => setAvailabilityOpen(true)}>
                      Update availability
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-2xl border bg-background p-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className={["h-2.5 w-2.5 rounded-full", candidate.looking_for_work ? "bg-success" : "bg-muted"].join(" ")} />
                  <span className="font-medium">{candidate.looking_for_work ? "Open to work" : "Not looking"}</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {availabilityJobTypes.length ? availabilityJobTypes.map((t) => t.replace("_", " ")).join(" · ") : "Add job types"}
                </div>
              </div>
              <div className="rounded-2xl border bg-background p-4">
                <div className="text-xs font-medium text-muted-foreground">Availability</div>
                <div className="mt-2 text-sm">
                  {availabilityHours || "Add available hours"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{candidate.work_timezone || "Add timezone"}</div>
              </div>
              <div className="rounded-2xl border bg-background p-4">
                <div className="text-xs font-medium text-muted-foreground">Preferred locations</div>
                <div className="mt-2 text-sm">
                  {availabilityLocations.length ? availabilityLocations.join(", ") : "Add preferred locations"}
                </div>
              </div>
              <div className="rounded-2xl border bg-background p-4">
                <div className="text-xs font-medium text-muted-foreground">Start date</div>
                <div className="mt-2 text-sm">{availabilityStartLabel || "Add start date"}</div>
              </div>
              <div className="rounded-2xl border bg-background p-4">
                <div className="text-xs font-medium text-muted-foreground">Compensation</div>
                <div className="mt-2 text-sm">
                  {candidate.current_salary ? `Current: ${candidate.current_salary}` : "Add current salary"}
                </div>
                <div className="mt-1 text-sm">
                  {candidate.expected_salary ? `Expected: ${candidate.expected_salary}` : "Add expected salary"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {candidate.notice_period ? `Notice period: ${candidate.notice_period}` : "Add notice period"}
                </div>
              </div>
              <div className="rounded-2xl border bg-background p-4 md:col-span-2 lg:col-span-3">
                <div className="text-xs font-medium text-muted-foreground">Availability notes</div>
                <div className="mt-2 text-sm text-muted-foreground">{candidate.availability_notes || "Add availability notes"}</div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border bg-card p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="text-base font-semibold">Skills</div>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-full border bg-card hover:bg-accent"
                onClick={() => {
                  setSkillsDraft(skills.join(", "))
                  setSkillsOpen(true)
                }}
                aria-label="Edit skills"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {skills.length ? (
                skills.map((s) => (
                  <Badge key={s} className="bg-primary/15 text-primary border-border/60">
                    {s}
                  </Badge>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">Add your skills to help matching.</div>
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <div className="rounded-3xl border bg-card p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-base font-semibold">Projects</div>
                  <button
                    className="flex h-9 w-9 items-center justify-center rounded-full border bg-card hover:bg-accent"
                    onClick={() => {
                      setProjectDraft({ id: crypto.randomUUID(), title: "", description: "", link: "", role: "", technologies: [] })
                      setProjectOpen(true)
                    }}
                    aria-label="Edit projects"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-4 grid gap-2">
                  {projectsList.length ? (
                    projectsList.slice(0, 10).map((p) => (
                      <div key={p.id} className="rounded-3xl border bg-background p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{p.title}</div>
                            {p.role ? <div className="mt-1 text-xs text-muted-foreground">{p.role}</div> : null}
                            {p.description ? <div className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{p.description}</div> : null}
                            {p.link ? (
                              <a className="mt-3 inline-block text-sm text-primary hover:underline" href={p.link} target="_blank" rel="noopener noreferrer">
                                {p.link}
                              </a>
                            ) : null}
                            {p.technologies?.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {p.technologies.slice(0, 10).map((t) => (
                                  <Badge key={t} className="bg-primary/15 text-primary border-border/60">
                                    {t}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className="flex h-9 w-9 items-center justify-center rounded-full border bg-card hover:bg-accent"
                              onClick={() => {
                                setProjectDraft({
                                  id: p.id,
                                  title: p.title,
                                  description: p.description || "",
                                  link: p.link || "",
                                  role: p.role || "",
                                  technologies: p.technologies || []
                                })
                                setProjectOpen(true)
                              }}
                              aria-label="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              className="flex h-9 w-9 items-center justify-center rounded-full border bg-card hover:bg-accent"
                              onClick={async () => {
                                const next = projectsList.filter((x) => x.id !== p.id)
                                setProjectsList(next)
                                await savePatch({ projects: serializeProjectItems(next) })
                              }}
                              aria-label="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">No projects added yet.</div>
                  )}
                </div>
              </div>
            </div>
            <div className="lg:col-span-6">
              <div className="rounded-3xl border bg-card p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-base font-semibold">Certifications</div>
                  <button
                    className="flex h-9 w-9 items-center justify-center rounded-full border bg-card hover:bg-accent"
                    onClick={() => {
                      setCertsDraft(certifications.join(", "))
                      setCertsOpen(true)
                    }}
                    aria-label="Edit certifications"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {certifications.length ? (
                    certifications.slice(0, 30).map((c) => (
                      <Badge key={c} className="bg-warning/15 text-warning border-border/60">
                        {c}
                      </Badge>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">No certifications added yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">Work history</div>
                <div className="mt-1 text-sm text-muted-foreground">Add your experience to build trust and match faster.</div>
              </div>
              <Button variant="secondary" onClick={openNewWork}>
                <Plus className="mr-2 h-4 w-4" />
                Add
              </Button>
            </div>

            <div className="mt-5 grid gap-4">
              {workItems.length ? (
                workItems.map((w) => (
                  <div key={w.id} className="rounded-3xl border bg-background p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{w.role}</div>
                        <div className="mt-1 text-sm text-muted-foreground truncate">{w.company}{w.location ? ` • ${w.location}` : ""}</div>
                        <div className="mt-2 text-xs text-muted-foreground">{w.duration}{w.is_current ? " • Present" : ""}</div>
                        {w.description ? <div className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{w.description}</div> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="flex h-9 w-9 items-center justify-center rounded-full border bg-card hover:bg-accent" onClick={() => openEditWork(w)} aria-label="Edit">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button className="flex h-9 w-9 items-center justify-center rounded-full border bg-card hover:bg-accent" onClick={() => deleteWork(w.id)} aria-label="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-3xl border border-dashed bg-card p-8 text-sm text-muted-foreground">No work history added yet.</div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">Education</div>
                <div className="mt-1 text-sm text-muted-foreground">Your education from resume parsing and manual edits.</div>
              </div>
              <Button variant="secondary" onClick={openNewEducation}>
                <Plus className="mr-2 h-4 w-4" />
                Add
              </Button>
            </div>

            <div className="mt-5 grid gap-4">
              {educationItems.length ? (
                educationItems.map((e) => (
                  <div key={e.id} className="rounded-3xl border bg-background p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {e.degree} • {e.institution}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {e.specialization ? `${e.specialization} • ` : ""}
                          {e.year || ""}
                          {e.percentage ? ` • ${e.percentage}` : ""}
                        </div>
                        {e.description ? <div className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{e.description}</div> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="flex h-9 w-9 items-center justify-center rounded-full border bg-card hover:bg-accent"
                          onClick={() => openEditEducation(e)}
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          className="flex h-9 w-9 items-center justify-center rounded-full border bg-card hover:bg-accent"
                          onClick={() => deleteEducation(e.id)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-3xl border border-dashed bg-card p-8 text-sm text-muted-foreground">No education added yet.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "resume" ? (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <div className="rounded-3xl border bg-card p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">Resume</div>
                  <div className="mt-1 text-sm text-muted-foreground">Visible to anyone who can access this profile.</div>
                </div>
                <div className="text-xs text-muted-foreground">Preview only</div>
              </div>
              <div className="mt-5">
                {resumeSignedUrl ? (
                  <iframe title="Resume preview" src={resumeSignedUrl} className="h-[640px] w-full rounded-2xl border" />
                ) : (
                  <div className="rounded-2xl border border-dashed bg-card p-8 text-sm text-muted-foreground">No resume uploaded yet.</div>
                )}
              </div>
            </div>
          </div>
          <div className="lg:col-span-4">
            <div className="rounded-3xl border bg-card p-6">
              <div className="text-base font-semibold">Resume file</div>
              <div className="mt-1 text-sm text-muted-foreground">Upload a PDF, DOC/DOCX, or TXT to keep your profile updated.</div>
              {resumeUploadError ? <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">{resumeUploadError}</div> : null}
              {candidate.file_name ? <div className="mt-3 text-sm font-medium">{candidate.file_name}</div> : null}
              {canEdit ? (
                <label className="mt-4 inline-flex w-full cursor-pointer items-center justify-center rounded-full border bg-card px-4 py-2 text-sm font-medium hover:bg-accent">
                  {resumeUploading ? "Uploading…" : "Upload resume"}
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file && !resumeUploading) void uploadResume(file)
                      e.currentTarget.value = ""
                    }}
                  />
                </label>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <WorkAvailabilityModal open={availabilityOpen} onClose={() => setAvailabilityOpen(false)} />

      <Modal open={bioOpen} onClose={() => setBioOpen(false)} title="Edit profile">
        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Full name</div>
              <Input value={bioDraft.name} onChange={(e) => setBioDraft({ ...bioDraft, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Email</div>
              <Input value={bioDraft.email} onChange={(e) => setBioDraft({ ...bioDraft, email: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Phone</div>
              <Input value={bioDraft.phone} onChange={(e) => setBioDraft({ ...bioDraft, phone: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Current role</div>
            <Input value={bioDraft.current_role} onChange={(e) => setBioDraft({ ...bioDraft, current_role: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Current company</div>
            <Input value={bioDraft.current_company} onChange={(e) => setBioDraft({ ...bioDraft, current_company: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Location</div>
            <div className="relative">
              <Input
                value={bioDraft.location}
                onChange={(e) => setBioDraft({ ...bioDraft, location: e.target.value })}
                onFocus={() => setBioLocFocused(true)}
                onBlur={() => window.setTimeout(() => setBioLocFocused(false), 120)}
                placeholder="e.g., Bengaluru"
              />
              {bioLocFocused && String(bioDraft.location || "").trim() && bioLocTypeahead.length ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border bg-background shadow-lg">
                  {bioLocTypeahead.map((opt) => (
                    <button
                      key={`bioLoc:${opt}`}
                      type="button"
                      onClick={() => setBioDraft({ ...bioDraft, location: opt })}
                      className="block w-full px-4 py-3 text-left text-sm hover:bg-accent"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Total experience</div>
              <Input value={bioDraft.total_experience} onChange={(e) => setBioDraft({ ...bioDraft, total_experience: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Desired role</div>
              <Input value={bioDraft.desired_role} onChange={(e) => setBioDraft({ ...bioDraft, desired_role: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Preferred location</div>
            <div className="relative">
              <div className="rounded-2xl border border-input bg-background px-4 py-2 focus-within:ring-2 focus-within:ring-ring/20">
                <div className="flex flex-wrap items-center gap-2">
                  {prefLocsDraft.map((v) => (
                    <button
                      key={`pl:${v}`}
                      type="button"
                      onClick={() => removePrefLoc(v)}
                      className="inline-flex items-center gap-2 rounded-full border bg-accent px-3 py-1 text-xs"
                    >
                      <span className="max-w-[180px] truncate">{v}</span>
                      <span className="text-muted-foreground">×</span>
                    </button>
                  ))}
                  <input
                    value={prefLocInput}
                    onChange={(e) => setPrefLocInput(e.target.value)}
                    onFocus={() => setPrefLocFocused(true)}
                    onBlur={() => window.setTimeout(() => setPrefLocFocused(false), 120)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        addPrefLoc(prefLocInput)
                      }
                    }}
                    placeholder={prefLocsDraft.length ? "Add location" : "Add preferred locations"}
                    className="min-w-[140px] flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>
              </div>

              {prefLocFocused && prefLocInput.trim() && prefLocTypeahead.length ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border bg-background shadow-lg">
                  {prefLocTypeahead.map((opt) => (
                    <button
                      key={`prefLoc:${opt}`}
                      type="button"
                      onClick={() => addPrefLoc(opt)}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Notice period</div>
              <Input value={bioDraft.notice_period} onChange={(e) => setBioDraft({ ...bioDraft, notice_period: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Current salary</div>
              <Input value={bioDraft.current_salary} onChange={(e) => setBioDraft({ ...bioDraft, current_salary: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Expected salary</div>
              <Input value={bioDraft.expected_salary} onChange={(e) => setBioDraft({ ...bioDraft, expected_salary: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Highest qualification</div>
              <Input value={bioDraft.highest_qualification} onChange={(e) => setBioDraft({ ...bioDraft, highest_qualification: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Degree</div>
              <Input value={bioDraft.degree} onChange={(e) => setBioDraft({ ...bioDraft, degree: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Specialization</div>
              <Input value={bioDraft.specialization} onChange={(e) => setBioDraft({ ...bioDraft, specialization: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">University</div>
              <Input value={bioDraft.university} onChange={(e) => setBioDraft({ ...bioDraft, university: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Bio</div>
            <Textarea value={bioDraft.summary} onChange={(e) => setBioDraft({ ...bioDraft, summary: e.target.value })} />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={async () => {
                const updated = await savePatch({
                  name: bioDraft.name,
                  email: bioDraft.email,
                  phone: bioDraft.phone || null,
                  current_role: bioDraft.current_role,
                  current_company: bioDraft.current_company || null,
                  location: bioDraft.location,
                  total_experience: bioDraft.total_experience,
                  desired_role: bioDraft.desired_role || null,
                  preferred_location: prefLocsDraft.join(", ") || null,
                  notice_period: bioDraft.notice_period || null,
                  current_salary: bioDraft.current_salary || null,
                  expected_salary: bioDraft.expected_salary || null,
                  highest_qualification: bioDraft.highest_qualification || null,
                  degree: bioDraft.degree || null,
                  specialization: bioDraft.specialization || null,
                  university: bioDraft.university || null,
                  summary: bioDraft.summary
                })
                setBioDraft({
                  name: updated.name || "",
                  email: updated.email || "",
                  phone: updated.phone || "",
                  current_role: updated.current_role || "",
                  current_company: updated.current_company || "",
                  total_experience: updated.total_experience || "",
                  desired_role: updated.desired_role || "",
                  preferred_location: updated.preferred_location || "",
                  current_salary: updated.current_salary || "",
                  expected_salary: updated.expected_salary || "",
                  notice_period: updated.notice_period || "",
                  highest_qualification: updated.highest_qualification || "",
                  degree: updated.degree || "",
                  specialization: updated.specialization || "",
                  university: updated.university || "",
                  summary: updated.summary || "",
                  location: updated.location || ""
                })
                setPrefLocsDraft(splitLocations(updated.preferred_location || ""))
                setPrefLocInput("")
                setBioOpen(false)
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={websitesOpen} onClose={() => setWebsitesOpen(false)} title="Websites">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">LinkedIn</div>
            <Input value={websitesDraft.linkedin_profile} onChange={(e) => setWebsitesDraft({ ...websitesDraft, linkedin_profile: e.target.value })} placeholder="https://" />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Portfolio</div>
            <Input value={websitesDraft.portfolio_url} onChange={(e) => setWebsitesDraft({ ...websitesDraft, portfolio_url: e.target.value })} placeholder="https://" />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">GitHub</div>
            <Input value={websitesDraft.github_profile} onChange={(e) => setWebsitesDraft({ ...websitesDraft, github_profile: e.target.value })} placeholder="https://" />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={async () => {
                await savePatch({
                  linkedin_profile: websitesDraft.linkedin_profile,
                  portfolio_url: websitesDraft.portfolio_url,
                  github_profile: websitesDraft.github_profile
                })
                setWebsitesOpen(false)
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={skillsOpen} onClose={() => setSkillsOpen(false)} title="Skills">
        <div className="grid gap-4">
          <div className="text-sm text-muted-foreground">Comma separated (e.g. TMS, Dispatch, Fleet ops)</div>
          <Input value={skillsDraft} onChange={(e) => setSkillsDraft(e.target.value)} />
          <div className="flex justify-end">
            <Button
              onClick={async () => {
                const normalized = splitSkills(skillsDraft)
                const nextMap = { ...preferences, skills: normalized.join(", ") }
                await savePatch({ tags: mapToTags(nextMap), technical_skills: normalized })
                setSkillsOpen(false)
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={certsOpen} onClose={() => setCertsOpen(false)} title="Certifications">
        <div className="grid gap-4">
          <div className="text-sm text-muted-foreground">Comma separated</div>
          <Input value={certsDraft} onChange={(e) => setCertsDraft(e.target.value)} />
          <div className="flex justify-end">
            <Button
              onClick={async () => {
                const arr = splitSkills(certsDraft)
                await savePatch({ certifications: arr })
                setCertsOpen(false)
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={projectOpen} onClose={() => setProjectOpen(false)} title={projectDraft.title ? "Project" : "Add project"}>
        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Title *</div>
              <Input value={projectDraft.title} onChange={(e) => setProjectDraft({ ...projectDraft, title: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Role</div>
              <Input value={projectDraft.role || ""} onChange={(e) => setProjectDraft({ ...projectDraft, role: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Link</div>
            <Input value={projectDraft.link || ""} onChange={(e) => setProjectDraft({ ...projectDraft, link: e.target.value })} placeholder="https://" />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Technologies (comma separated)</div>
            <Input
              value={(projectDraft.technologies || []).join(", ")}
              onChange={(e) =>
                setProjectDraft({
                  ...projectDraft,
                  technologies: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                })
              }
            />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Description</div>
            <Textarea value={projectDraft.description || ""} onChange={(e) => setProjectDraft({ ...projectDraft, description: e.target.value })} />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={async () => {
                const title = (projectDraft.title || "").trim()
                if (!title) return
                const item: ProjectItem = {
                  id: projectDraft.id || (globalThis.crypto && "randomUUID" in globalThis.crypto ? (globalThis.crypto as any).randomUUID() : String(Date.now())),
                  title,
                  description: (projectDraft.description || "").trim() || undefined,
                  link: (projectDraft.link || "").trim() || undefined,
                  role: (projectDraft.role || "").trim() || undefined,
                  technologies: Array.isArray(projectDraft.technologies) ? projectDraft.technologies : []
                }
                const next = projectsList.some((p) => p.id === item.id)
                  ? projectsList.map((p) => (p.id === item.id ? item : p))
                  : [item, ...projectsList]
                setProjectsList(next)
                await savePatch({ projects: serializeProjectItems(next) })
                setProjectOpen(false)
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={educationOpen} onClose={() => setEducationOpen(false)} title={educationDraft.id ? "Edit education" : "Add education"}>
        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Degree *</div>
              <Input value={educationDraft.degree} onChange={(e) => setEducationDraft({ ...educationDraft, degree: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Institution *</div>
              <Input value={educationDraft.institution} onChange={(e) => setEducationDraft({ ...educationDraft, institution: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Specialization</div>
              <Input value={educationDraft.specialization} onChange={(e) => setEducationDraft({ ...educationDraft, specialization: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Year</div>
              <Input value={educationDraft.year} onChange={(e) => setEducationDraft({ ...educationDraft, year: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Percentage/CGPA</div>
            <Input value={educationDraft.percentage} onChange={(e) => setEducationDraft({ ...educationDraft, percentage: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Description</div>
            <Textarea value={educationDraft.description} onChange={(e) => setEducationDraft({ ...educationDraft, description: e.target.value })} />
          </div>
          <div className="flex justify-end">
            <Button onClick={saveEducation}>Save</Button>
          </div>
        </div>
      </Modal>

      <Modal open={workOpen} onClose={() => setWorkOpen(false)} title={workDraft.id ? "Edit work history" : "Add work history"}>
        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Company *</div>
              <Input value={workDraft.company} onChange={(e) => setWorkDraft({ ...workDraft, company: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Role *</div>
              <Input value={workDraft.role} onChange={(e) => setWorkDraft({ ...workDraft, role: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Duration *</div>
              <Input value={workDraft.duration} onChange={(e) => setWorkDraft({ ...workDraft, duration: e.target.value })} placeholder="Apr 2024 - Present" />
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Location</div>
              <Input value={workDraft.location} onChange={(e) => setWorkDraft({ ...workDraft, location: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">Description</div>
            <Textarea value={workDraft.description} onChange={(e) => setWorkDraft({ ...workDraft, description: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(workDraft.is_current)} onChange={(e) => setWorkDraft({ ...workDraft, is_current: e.target.checked })} />
            Current role
          </label>
          <div className="flex justify-end">
            <Button onClick={saveWork}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
