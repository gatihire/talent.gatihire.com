import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getAuthedUser } from "@/lib/apiServerAuth"
import { cache } from "@/lib/cache"

export const runtime = "nodejs"

function nowIso() {
  return new Date().toISOString()
}

function normalizeStringArray(v: unknown) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean)
  if (typeof v === "string") {
    const out = v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    return out
  }
  return null
}

function normalizeProjects(v: unknown) {
  if (Array.isArray(v)) return v
  if (typeof v === "string") {
    return v
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return null
}

function normalizePhone(raw: unknown) {
  const input = typeof raw === "string" ? raw.trim() : ""
  if (!input) return { ok: false as const, value: "", error: "Missing required field: phone" }
  const digits = input.replace(/\D+/g, "")
  if (digits.length === 10) return { ok: true as const, value: `+91${digits}` }
  if (digits.length === 12 && digits.startsWith("91")) return { ok: true as const, value: `+${digits}` }
  if (input.startsWith("+") && digits.length >= 10 && digits.length <= 15) return { ok: true as const, value: `+${digits}` }
  return { ok: false as const, value: "", error: "Invalid phone number. Use 10 digits or +91XXXXXXXXXX." }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 50)
}

function randomSuffix(len = 5) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let out = ""
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

async function pickUniquePublicSlug(desired: string, selfId: string | null | undefined) {
  const base = slugify(desired)
  if (!base) return `talent-${randomSuffix(6)}`

  const { data: rows } = await supabaseAdmin
    .from("candidates")
    .select("id, public_profile_slug")
    .like("public_profile_slug", `${base}%`)

  const used = new Set<string>()
  for (const r of rows || []) {
    if (!r?.public_profile_slug) continue
    if (selfId && r.id === selfId) continue
    used.add(String(r.public_profile_slug))
  }

  if (!used.has(base)) return base
  for (let n = 2; n <= 50; n++) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${randomSuffix(4)}`
}

export async function GET(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const details = request.nextUrl.searchParams.get("details")
  const includeDetails = details !== "0"
  const cacheKey = `candidate:profile:${user.id}:${includeDetails ? "full" : "lite"}`
  const cached = await cache.get(cacheKey)
  if (cached) return NextResponse.json(cached)

  const userEmail = String((user as any)?.email || "").trim().toLowerCase()
  const query = supabaseAdmin.from("candidates").select("id,auth_user_id,name,email,phone,current_role,current_company,total_experience,location,preferred_location,desired_role,current_salary,expected_salary,notice_period,highest_qualification,degree,specialization,university,education_year,education_percentage,additional_qualifications,summary,linkedin_profile,portfolio_url,github_profile,technical_skills,soft_skills,languages_known,certifications,projects,tags,preferred_roles,open_job_types,public_profile_enabled,public_profile_slug,file_url,file_name,uploaded_at,updated_at")
  let candidateResult = await query.eq("auth_user_id", user.id).maybeSingle()
  if (!candidateResult.data && userEmail) {
    candidateResult = await query.eq("email", userEmail).maybeSingle()
  }
  const { data: candidate, error } = candidateResult
  if (error) return NextResponse.json({ error: "Failed to load candidate" }, { status: 500 })
  if (!candidate) {
    const payload = { candidate: null }
    await cache.set(cacheKey, payload, 15)
    return NextResponse.json(payload)
  }

  let workItems: any[] = []
  let educationItems: any[] = []
  if (includeDetails) {
    const [workRes, eduRes] = await Promise.all([
      supabaseAdmin.from("work_experience").select("*").eq("candidate_id", candidate.id).order("start_date", { ascending: false }),
      supabaseAdmin.from("education").select("*").eq("candidate_id", candidate.id).order("end_date", { ascending: false })
    ])
    workItems = workRes.data || []
    educationItems = eduRes.data || []
  }

  const payload = {
    candidate,
    workItems,
    educationItems
  }
  await cache.set(cacheKey, payload, 15)
  return NextResponse.json(payload)
}

export async function PUT(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userEmail = String((user as any)?.email || "").trim().toLowerCase()

  const body = (await request.json().catch(() => null)) as any
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

  const patch: Record<string, unknown> = {
    updated_at: nowIso()
  }

  const allowed = [
    "name",
    "email",
    "phone",
    "current_role",
    "current_company",
    "total_experience",
    "location",
    "preferred_location",
    "desired_role",
    "current_salary",
    "expected_salary",
    "notice_period",
    "highest_qualification",
    "degree",
    "specialization",
    "university",
    "education_year",
    "education_percentage",
    "additional_qualifications",
    "summary",
    "linkedin_profile",
    "portfolio_url",
    "github_profile",
    "technical_skills",
    "soft_skills",
    "languages_known",
    "certifications",
    "projects",
    "tags",
    "preferred_roles",
    "open_job_types",
    "public_profile_enabled",
    "public_profile_slug"
  ]

  for (const k of allowed) {
    if (k in body) patch[k] = body[k]
  }

  if ("email" in patch) {
    const raw = patch.email
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : ""
    if (!email) return NextResponse.json({ error: "Missing required field: email" }, { status: 400 })
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Invalid email" }, { status: 400 })
    patch.email = email
  }

  if ("phone" in patch) {
    const normalized = normalizePhone(patch.phone)
    if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 })
    patch.phone = normalized.value
  }

  const normalizedArrays: Record<string, string[]> = {}
  for (const k of ["technical_skills", "soft_skills", "languages_known", "certifications"]) {
    if (k in patch) {
      const arr = normalizeStringArray(patch[k])
      if (arr) normalizedArrays[k] = arr
      else normalizedArrays[k] = []
    }
  }
  for (const [k, v] of Object.entries(normalizedArrays)) patch[k] = v

  for (const k of ["preferred_roles", "open_job_types"]) {
    if (k in patch) {
      const arr = normalizeStringArray(patch[k])
      patch[k] = arr ?? []
    }
  }

  if ("projects" in patch) {
    const normalized = normalizeProjects(patch.projects)
    patch.projects = normalized ?? []
  }

  const required = ["name", "email", "phone", "current_role", "total_experience", "location"]
  for (const k of required) {
    const v = patch[k]
    if (typeof v === "string" && !v.trim()) return NextResponse.json({ error: `Missing required field: ${k}` }, { status: 400 })
  }

  const findQuery = supabaseAdmin.from("candidates").select("id, public_profile_slug, auth_user_id")
  const { data: existing, error: findErr } = userEmail
    ? await findQuery.or(`auth_user_id.eq.${user.id},email.eq.${userEmail}`).maybeSingle()
    : await findQuery.eq("auth_user_id", user.id).maybeSingle()
  if (findErr) return NextResponse.json({ error: "Failed to load candidate" }, { status: 500 })

  if (patch.public_profile_slug && typeof patch.public_profile_slug === "string") {
    patch.public_profile_slug = slugify(patch.public_profile_slug)
  }

  const wantsPublic = Boolean(patch.public_profile_enabled)
  if (wantsPublic) {
    const desiredRaw =
      typeof patch.public_profile_slug === "string" && patch.public_profile_slug.trim()
        ? patch.public_profile_slug.trim()
        : typeof patch.name === "string" && patch.name.trim()
          ? patch.name.trim()
          : userEmail
            ? userEmail.split("@")[0]
            : "talent"
    patch.public_profile_slug = await pickUniquePublicSlug(desiredRaw, existing?.id)
  }

  const linkingAuth = Boolean(existing?.id && !existing?.auth_user_id)
  if (linkingAuth) patch.auth_user_id = user.id

  if (existing?.id) {
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("candidates")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single()

    if (updateErr) return NextResponse.json({ error: "Failed to update candidate" }, { status: 500 })

    if (linkingAuth) {
      const now = nowIso()
      await supabaseAdmin
        .from("applications")
        .update({ source: "database > board-app", updated_at: now })
        .eq("candidate_id", existing.id)
        .eq("source", "database")

      if (userEmail) {
        await supabaseAdmin
          .from("job_invites")
          .update({ candidate_id: existing.id, responded_at: now, updated_at: now })
          .eq("email", userEmail)
          .is("candidate_id", null)
      }
    }

    await cache.del(`candidate:profile:${user.id}`)
    return NextResponse.json({ candidate: updated })
  }

  const name = typeof patch.name === "string" ? patch.name : userEmail ? userEmail.split("@")[0] : "Candidate"
  const current_role = typeof patch.current_role === "string" ? patch.current_role : "Candidate"
  const total_experience = typeof patch.total_experience === "string" ? patch.total_experience : "0"
  const location = typeof patch.location === "string" ? patch.location : "Unknown"
  const email =
    typeof patch.email === "string" && patch.email.trim()
      ? patch.email.trim().toLowerCase()
      : userEmail
  if (!email) return NextResponse.json({ error: "Missing required field: email" }, { status: 400 })

  const insertPayload = {
    auth_user_id: user.id,
    email,
    name,
    current_role,
    total_experience,
    location,
    phone: typeof patch.phone === "string" ? patch.phone : null,
    desired_role: typeof patch.desired_role === "string" ? patch.desired_role : null,
    preferred_location: typeof patch.preferred_location === "string" ? patch.preferred_location : null,
    summary: typeof patch.summary === "string" ? patch.summary : null,
    linkedin_profile: typeof patch.linkedin_profile === "string" ? patch.linkedin_profile : null,
    portfolio_url: typeof patch.portfolio_url === "string" ? patch.portfolio_url : null,
    github_profile: typeof patch.github_profile === "string" ? patch.github_profile : null,
    public_profile_enabled: Boolean(patch.public_profile_enabled),
    public_profile_slug: typeof patch.public_profile_slug === "string" ? (patch.public_profile_slug as string) : null,
    tags: patch.tags ?? null,
    status: "new",
    uploaded_at: nowIso(),
    updated_at: nowIso()
  }

  const { data: created, error: createErr } = await supabaseAdmin
    .from("candidates")
    .insert(insertPayload)
    .select("*")
    .single()
  if (createErr) return NextResponse.json({ error: "Failed to create candidate" }, { status: 500 })

  ;(async () => {
    try {
      await supabaseAdmin.from("candidate_notifications").insert({
        candidate_id: (created as any).id,
        type: "welcome",
        payload: { message: "Welcome to GatiHire. Complete your profile to apply faster." }
      })
    } catch {
      return
    }
  })()

  await cache.del(`candidate:profile:${user.id}`)
  return NextResponse.json({ candidate: created })
}
