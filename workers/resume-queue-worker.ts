import { GoogleGenerativeAI } from "@google/generative-ai"
import * as Sentry from "@sentry/nextjs"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { RESUME_BUCKET } from "@/lib/constants/storage"
import { parseResume } from "@/lib/resume-parser"
import { generateEmbedding } from "@/lib/embedding"

const sentryDsn =
  process.env.SENTRY_DSN ||
  process.env.NEXT_PUBLIC_SENTRY_DSN ||
  "https://e7a6643eb1a0a6b870959cda4760b205@o4511007385911296.ingest.us.sentry.io/4511007389515776"
Sentry.init({ dsn: sentryDsn, tracesSampleRate: 0.1 })

function nowIso() {
  return new Date().toISOString()
}

function nonEmptyString(v: unknown) {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t || t.toLowerCase() === "not specified" || t.toLowerCase() === "unknown") return null
  return t
}

function nonEmptyStringArray(v: unknown) {
  if (!Array.isArray(v)) return null
  const cleaned = v
    .filter((x) => typeof x === "string")
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && x.toLowerCase() !== "unknown" && x.toLowerCase() !== "not specified")
  return cleaned.length ? cleaned : null
}

function buildEmbeddingInput(parsed: any, candidateUpdate: Record<string, unknown>) {
  const parts = [
    typeof candidateUpdate.current_role === "string" ? candidateUpdate.current_role : "",
    typeof candidateUpdate.current_company === "string" ? candidateUpdate.current_company : "",
    typeof candidateUpdate.location === "string" ? candidateUpdate.location : "",
    typeof candidateUpdate.summary === "string" ? candidateUpdate.summary : "",
    typeof parsed?.resumeText === "string" ? parsed.resumeText : "",
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
  return parts.join("\n")
}

async function downloadResumeFile(filePath: string, fallbackUrl: string | null, fileName: string, fileType: string | null) {
  const { data, error } = await supabaseAdmin.storage.from(RESUME_BUCKET).download(filePath)
  if (error || !data) {
    if (fallbackUrl) {
      const res = await fetch(fallbackUrl)
      if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
      const blob = await res.blob()
      return { blob, name: fileName, type: blob.type || fileType || "application/octet-stream" }
    }
    throw new Error(`Storage download failed: ${error?.message || "unknown"}`)
  }
  const blob = data as unknown as Blob
  return { blob, name: fileName, type: (blob as any)?.type || fileType || "application/octet-stream" }
}

async function toFileLike(blob: Blob, name: string, type: string) {
  const g: any = globalThis as any
  if (typeof g.File === "function") {
    return new g.File([blob], name, { type })
  }
  return {
    name,
    type,
    arrayBuffer: async () => await blob.arrayBuffer(),
  }
}

function backoffSeconds(attempt: number) {
  if (attempt <= 1) return 10
  if (attempt === 2) return 30
  if (attempt === 3) return 90
  return 300
}

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

function mapToTags(map: Record<string, string>) {
  const out: string[] = []
  for (const [k, v] of Object.entries(map)) {
    if (!v) continue
    out.push(`${k}:${v}`)
  }
  return out
}

function guessLogisticsBackgroundFromKeywords(text: string) {
  const t = String(text || "").toLowerCase()
  if (!t) return null
  const keywords = [
    "logistics",
    "supply chain",
    "supplychain",
    "warehouse",
    "warehousing",
    "dispatch",
    "fleet",
    "transport",
    "transportation",
    "freight",
    "shipment",
    "shipping",
    "delivery",
    "last mile",
    "last-mile",
    "3pl",
    "cold chain",
    "line haul",
    "line-haul",
    "route planning",
    "load planning",
    "tms",
    "wms",
    "inventory",
    "procurement",
    "driver",
    "truck",
    "trucking",
    "carrier",
    "broker",
  ]
  const hit = keywords.some((k) => t.includes(k))
  return hit ? "yes" : null
}

async function inferLogisticsBackground(text: string) {
  const byKeywords = guessLogisticsBackgroundFromKeywords(text)
  if (byKeywords) return { value: byKeywords, source: "keywords" }
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { value: "no", source: "default" }

  const genAI = new GoogleGenerativeAI(apiKey)
  const modelName = process.env.GEMINI_CLASSIFIER_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash"
  const model = genAI.getGenerativeModel({ model: modelName })

  const limited = String(text || "").slice(0, 6000)
  const prompt = `Decide if this candidate has logistics/transportation/supply-chain background.

Return ONLY valid JSON with keys:
- logistics_background: "yes" or "no"
- confidence: number 0-1

Candidate resume text:
${limited}`

  const result: any = await model.generateContent(prompt)
  const content = result.response.text()
  const match = content.match(/\{[\s\S]*\}/)
  const parsed = match ? JSON.parse(match[0]) : null
  const v = String(parsed?.logistics_background || "").toLowerCase()
  if (v === "yes" || v === "no") return { value: v, source: "gemini", confidence: Number(parsed?.confidence ?? null) }
  return { value: "no", source: "default" }
}

function normalizeJobType(v: unknown) {
  const t = String(v || "").toLowerCase().replace(/\s+/g, " ").trim()
  if (!t) return null
  if (t.includes("full")) return "full_time"
  if (t.includes("part")) return "part_time"
  if (t.includes("contract") || t.includes("freelance")) return "contract"
  return null
}

async function processOne(job: any, workerId: string) {
  const jobId = String(job.id)
  const candidateId = String(job.candidate_id)
  const parsingJobId = String(job.parsing_job_id)
  const fileId = String(job.file_id)
  const filePath = String(job.file_path)

  await supabaseAdmin
    .from("parsing_jobs")
    .update({ status: "processing", started_at: nowIso() })
    .eq("id", parsingJobId)
    .eq("candidate_id", candidateId)

  const { data: fileRow, error: fErr } = await supabaseAdmin
    .from("file_storage")
    .select("id,file_name,file_url,file_type,file_size,original_path")
    .eq("id", fileId)
    .eq("candidate_id", candidateId)
    .single()

  if (fErr || !fileRow) throw new Error("File metadata not found")

  const fileName = String(fileRow.file_name || "resume")
  const fileType = typeof fileRow.file_type === "string" ? fileRow.file_type : null
  const storagePath = String(fileRow.original_path || filePath)
  const fileUrl = typeof fileRow.file_url === "string" ? fileRow.file_url : null

  const { blob, name, type } = await downloadResumeFile(storagePath, fileUrl, fileName, fileType)
  const fileLike = await toFileLike(blob, name, type)

  const parsed = await parseResume(fileLike as any)

  const candidateUpdate: Record<string, unknown> = {
    file_name: fileName,
    file_url: fileUrl,
    file_size: fileRow.file_size,
    file_type: fileType || "application/octet-stream",
    uploaded_at: nowIso(),
    updated_at: nowIso(),
  }

  const nameV = nonEmptyString((parsed as any).name)
  const phone = nonEmptyString((parsed as any).phone)
  const currentRole = nonEmptyString((parsed as any).currentRole)
  const currentCompany = nonEmptyString((parsed as any).currentCompany)
  const location = nonEmptyString((parsed as any).location)
  const totalExperience = nonEmptyString((parsed as any).totalExperience)
  const highestQualification = nonEmptyString((parsed as any).highestQualification)
  const degree = nonEmptyString((parsed as any).degree)
  const specialization = nonEmptyString((parsed as any).specialization)
  const university = nonEmptyString((parsed as any).university)
  const educationYear = nonEmptyString((parsed as any).educationYear)
  const educationPercentage = nonEmptyString((parsed as any).educationPercentage)
  const additionalQualifications = nonEmptyString((parsed as any).additionalQualifications)
  const summary = nonEmptyString((parsed as any).summary)
  const resumeText = nonEmptyString((parsed as any).resumeText)

  const technicalSkills = nonEmptyStringArray((parsed as any).technicalSkills)
  const softSkills = nonEmptyStringArray((parsed as any).softSkills)
  const languagesKnown = nonEmptyStringArray((parsed as any).languagesKnown)
  const certifications = nonEmptyStringArray((parsed as any).certifications)
  const previousCompanies = nonEmptyStringArray((parsed as any).previousCompanies)
  const jobTitles = nonEmptyStringArray((parsed as any).jobTitles)
  const workDuration = nonEmptyStringArray((parsed as any).workDuration)
  const keyAchievements = nonEmptyStringArray((parsed as any).keyAchievements)
  const projects = nonEmptyStringArray((parsed as any).projects)

  if (phone) candidateUpdate.phone = phone
  if (nameV) candidateUpdate.name = nameV
  if (currentRole) candidateUpdate.current_role = currentRole
  if (currentCompany) candidateUpdate.current_company = currentCompany
  if (location) candidateUpdate.location = location
  if (totalExperience) candidateUpdate.total_experience = totalExperience
  if (highestQualification) candidateUpdate.highest_qualification = highestQualification
  if (degree) candidateUpdate.degree = degree
  if (specialization) candidateUpdate.specialization = specialization
  if (university) candidateUpdate.university = university
  if (educationYear) candidateUpdate.education_year = educationYear
  if (educationPercentage) candidateUpdate.education_percentage = educationPercentage
  if (additionalQualifications) candidateUpdate.additional_qualifications = additionalQualifications
  if (summary) candidateUpdate.summary = summary
  if (resumeText) candidateUpdate.resume_text = resumeText

  if (technicalSkills) candidateUpdate.technical_skills = technicalSkills
  if (softSkills) candidateUpdate.soft_skills = softSkills
  if (languagesKnown) candidateUpdate.languages_known = languagesKnown
  if (certifications) candidateUpdate.certifications = certifications
  if (previousCompanies) candidateUpdate.previous_companies = previousCompanies
  if (jobTitles) candidateUpdate.job_titles = jobTitles
  if (workDuration) candidateUpdate.work_duration = workDuration
  if (keyAchievements) candidateUpdate.key_achievements = keyAchievements
  if (projects) candidateUpdate.projects = projects

  const parsingMethod = process.env.GEMINI_API_KEY ? "gemini" : process.env.OPENROUTER_API_KEY ? "openrouter" : "basic"
  candidateUpdate.parsing_method = parsingMethod

  let resumeTextValue = ""
  if (resumeText) resumeTextValue = resumeText

  const { data: existingPrefs } = await supabaseAdmin
    .from("candidates")
    .select("preferred_roles,open_job_types,preferred_location,tags")
    .eq("id", candidateId)
    .maybeSingle()

  const apiKey = process.env.GEMINI_API_KEY
  if (resumeTextValue && apiKey) {
    try {
      const limited = String(resumeTextValue || "").slice(0, 7000)
      const genAI = new GoogleGenerativeAI(apiKey)
      const modelName = process.env.GEMINI_CLASSIFIER_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash"
      const model = genAI.getGenerativeModel({ model: modelName })
      const prompt = `You are helping a logistics/transportation job platform.

From the resume text, infer candidate job preferences.
Return ONLY valid JSON with keys:
- preferred_roles: array of 1-5 role titles (strings)
- open_job_types: array containing any of "full_time","part_time","contract" (0-3 items)
- preferred_location: string (city/region) or empty string if unknown

Resume text:
${limited}`

      const result: any = await model.generateContent(prompt)
      const content = result.response.text()
      const match = content.match(/\{[\s\S]*\}/)
      const parsed = match ? JSON.parse(match[0]) : null

      const roles = Array.isArray(parsed?.preferred_roles)
        ? (parsed.preferred_roles as unknown[]).filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 8)
        : []
      const jobTypesRaw = Array.isArray(parsed?.open_job_types) ? (parsed.open_job_types as unknown[]) : []
      const jobTypes = Array.from(new Set(jobTypesRaw.map(normalizeJobType).filter(Boolean))) as string[]
      const preferred_location = typeof parsed?.preferred_location === "string" ? parsed.preferred_location.trim() : ""

      const hasRoles = Array.isArray((existingPrefs as any)?.preferred_roles) && (existingPrefs as any).preferred_roles.length
      const hasTypes = Array.isArray((existingPrefs as any)?.open_job_types) && (existingPrefs as any).open_job_types.length
      const hasLoc = typeof (existingPrefs as any)?.preferred_location === "string" && (existingPrefs as any)?.preferred_location.trim()

      if (!hasRoles && roles.length) candidateUpdate.preferred_roles = roles.slice(0, 5)
      if (!hasTypes && jobTypes.length) candidateUpdate.open_job_types = jobTypes
      if (!hasLoc && preferred_location) candidateUpdate.preferred_location = preferred_location
    } catch {
    }
  }

  const tagsMap = tagsToMap((existingPrefs as any)?.tags)
  try {
    const inferred = await inferLogisticsBackground(resumeTextValue || "")
    if (!tagsMap.logistics_background) {
      tagsMap.logistics_background = inferred.value
    }
  } catch {
    if (!tagsMap.logistics_background) tagsMap.logistics_background = "no"
  }
  candidateUpdate.tags = mapToTags(tagsMap)

  try {
    const input = buildEmbeddingInput(parsed, candidateUpdate)
    const embedding = await generateEmbedding(input)
    const expectedDim = Number(process.env.EMBEDDING_DIM || 768)
    if (Array.isArray(embedding) && embedding.length === expectedDim) {
      candidateUpdate.embedding = embedding
    }
  } catch {
  }

  const { data: updatedCandidate, error: candErr } = await supabaseAdmin
    .from("candidates")
    .update(candidateUpdate)
    .eq("id", candidateId)
    .select("id")
    .single()

  if (candErr || !updatedCandidate) throw new Error("Failed to update candidate")

  const parsedWorkExperience = Array.isArray((parsed as any).workExperience) ? ((parsed as any).workExperience as any[]) : []
  const parsedEducation = Array.isArray((parsed as any).education) ? ((parsed as any).education as any[]) : []

  if (parsedWorkExperience.length) {
    await supabaseAdmin.from("work_experience").delete().eq("candidate_id", candidateId)

    const rows = parsedWorkExperience
      .map((it) => {
        const company = nonEmptyString(it?.company)
        const role = nonEmptyString(it?.role)
        const duration = nonEmptyString(it?.duration)
        if (!company && !role) return null
        const responsibilities = Array.isArray(it?.responsibilities)
          ? it.responsibilities.map((x: any) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).join("\n")
          : nonEmptyString(it?.responsibilities)
        const achievements = Array.isArray(it?.achievements)
          ? it.achievements.map((x: any) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).join("\n")
          : nonEmptyString(it?.achievements)
        const technologies = nonEmptyStringArray(it?.technologies)
        return {
          candidate_id: candidateId,
          company: company || "Not specified",
          role: role || "Not specified",
          duration: duration || "Not specified",
          location: nonEmptyString(it?.location),
          description: nonEmptyString(it?.description),
          responsibilities,
          achievements,
          technologies,
          created_at: nowIso(),
        }
      })
      .filter(Boolean) as any[]

    if (rows.length) await supabaseAdmin.from("work_experience").insert(rows)
  }

  if (parsedEducation.length) {
    await supabaseAdmin.from("education").delete().eq("candidate_id", candidateId)

    const rows = parsedEducation
      .map((it) => {
        const degree = nonEmptyString(it?.degree)
        const institution = nonEmptyString(it?.institution) || nonEmptyString(it?.university)
        if (!degree && !institution) return null
        return {
          candidate_id: candidateId,
          degree: degree || "Not specified",
          specialization: nonEmptyString(it?.specialization),
          institution: institution || "Not specified",
          year: nonEmptyString(it?.year) || nonEmptyString(it?.endYear) || nonEmptyString(it?.educationYear),
          percentage: nonEmptyString(it?.percentage),
          description: nonEmptyString(it?.description),
          created_at: nowIso(),
        }
      })
      .filter(Boolean) as any[]

    if (rows.length) await supabaseAdmin.from("education").insert(rows)
  }

  await supabaseAdmin
    .from("parsing_jobs")
    .update({ status: "completed", parsing_method: parsingMethod, completed_at: nowIso() })
    .eq("id", parsingJobId)
    .eq("candidate_id", candidateId)

  await supabaseAdmin
    .from("resume_parse_jobs")
    .update({ status: "succeeded", locked_by: workerId, locked_at: nowIso(), updated_at: nowIso(), error: null })
    .eq("id", jobId)
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

async function claimJobs(workerId: string, batchSize: number) {
  const { data, error } = await supabaseAdmin.rpc("claim_resume_parse_jobs", {
    worker_id: workerId,
    batch_size: batchSize,
  })

  if (!error) return Array.isArray(data) ? data : []

  console.error("claim_resume_parse_jobs failed", error)

  const { data: rows, error: listErr } = await supabaseAdmin
    .from("resume_parse_jobs")
    .select("*")
    .eq("status", "queued")
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso()}`)
    .order("created_at", { ascending: true })
    .limit(batchSize)

  if (listErr || !rows?.length) return []

  const locked: any[] = []
  for (const row of rows) {
    const { data: lockedRow, error: lockErr } = await supabaseAdmin
      .from("resume_parse_jobs")
      .update({ status: "processing", locked_by: workerId, locked_at: nowIso(), updated_at: nowIso() })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("*")
      .single()
    if (!lockErr && lockedRow) locked.push(lockedRow)
  }

  return locked
}

async function run() {
  const workerId = process.env.WORKER_ID || `worker_${Math.random().toString(16).slice(2)}`
  const batchSize = Math.min(50, Math.max(1, Number(process.env.WORKER_BATCH_SIZE || 5)))
  const pollMs = Math.min(10000, Math.max(500, Number(process.env.WORKER_POLL_MS || 2000)))
  const maxAttempts = Math.min(10, Math.max(1, Number(process.env.WORKER_MAX_ATTEMPTS || 3)))
  const envReady = Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!envReady) {
    console.error("resume worker missing supabase env. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY")
    Sentry.captureMessage("resume worker missing supabase env", { level: "error" })
  }
  console.log("resume worker started", { workerId, batchSize, pollMs, maxAttempts })

  let shouldStop = false
  let idleCycles = 0
  process.on("SIGTERM", () => {
    shouldStop = true
  })
  process.on("SIGINT", () => {
    shouldStop = true
  })

  while (!shouldStop) {
    const list = await claimJobs(workerId, batchSize)
    if (!list.length) {
      idleCycles += 1
      if (idleCycles % 5 === 0) {
        console.log("resume worker idle", { workerId, pollMs })
      }
      await sleep(pollMs)
      continue
    }
    idleCycles = 0
    console.log("resume worker claimed jobs", { workerId, count: list.length })

    for (const job of list) {
      const jobId = String(job.id)
      const attempts = Number(job.attempts || 0)
      try {
        console.log("resume worker processing job", { jobId, candidateId: String(job.candidate_id), attempts })
        await processOne(job, workerId)
        console.log("resume worker job completed", { jobId })
      } catch (e: any) {
        const msg = String(e?.message || e)
        console.error("resume job failed", { jobId, attempts, msg })
        Sentry.captureException(e, { tags: { jobId, workerId }, extra: { attempts, candidateId: String(job.candidate_id || "") } })
        const nextAttempts = attempts + 1
        const willRetry = nextAttempts < maxAttempts
        const nextRunAt = willRetry ? new Date(Date.now() + backoffSeconds(nextAttempts) * 1000).toISOString() : null

        await supabaseAdmin
          .from("resume_parse_jobs")
          .update({
            status: willRetry ? "queued" : "failed",
            next_run_at: nextRunAt,
            error: msg,
            updated_at: nowIso(),
            locked_by: workerId,
            locked_at: nowIso(),
          })
          .eq("id", jobId)

        try {
          const candidateId = String(job.candidate_id)
          const parsingJobId = String(job.parsing_job_id)
          await supabaseAdmin
            .from("parsing_jobs")
            .update({ status: willRetry ? "queued" : "failed", completed_at: willRetry ? null : nowIso() })
            .eq("id", parsingJobId)
            .eq("candidate_id", candidateId)
        } catch {
        }
      }
    }
  }
}

run().catch(() => {
  process.exit(1)
})
