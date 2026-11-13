import { GoogleGenerativeAI } from "@google/generative-ai"
import * as Sentry from "@sentry/nextjs"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { RESUME_BUCKET } from "@/lib/constants/storage"
import { ingestResume } from "@/lib/resume-ingest"
import { RESUME_PARSE_MODELS } from "@/lib/resume-parser"

const sentryDsn =
  process.env.SENTRY_DSN ||
  process.env.NEXT_PUBLIC_SENTRY_DSN ||
  "https://e7a6643eb1a0a6b870959cda4760b205@o4511007385911296.ingest.us.sentry.io/4511007389515776"
Sentry.init({ dsn: sentryDsn, tracesSampleRate: 0.1 })

function nowIso() {
  return new Date().toISOString()
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
  const modelName = process.env.GEMINI_CLASSIFIER_MODEL || process.env.GEMINI_MODEL || RESUME_PARSE_MODELS[0]
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

  //
  // One ingestion path for every resume -- the same module the public apply
  // route uses. It never throws for a parse failure: it returns whatever it
  // could extract plus a state, so a resume is never thrown away.
  //
  const result = await ingestResume(fileLike as any)

  const parsingMethod = process.env.GEMINI_API_KEY ? "gemini" : process.env.OPENROUTER_API_KEY ? "openrouter" : "basic"

  const candidateUpdate: Record<string, unknown> = {
    ...result.fields,
    file_name: fileName,
    file_url: fileUrl,
    file_size: fileRow.file_size,
    file_type: fileType || "application/octet-stream",
    parsing_method: parsingMethod,
    resume_parse_state: result.state,
    resume_parse_error: result.error ?? null,
    uploaded_at: nowIso(),
    updated_at: nowIso(),
  }

  // Preferences inferred from the resume text (only when the candidate has
  // not already set them).
  const { data: existingPrefs } = await supabaseAdmin
    .from("candidates")
    .select("preferred_roles,open_job_types,preferred_location,tags")
    .eq("id", candidateId)
    .maybeSingle()

  const apiKey = process.env.GEMINI_API_KEY
  if (result.resumeText && apiKey) {
    try {
      const limited = String(result.resumeText || "").slice(0, 7000)
      const genAI = new GoogleGenerativeAI(apiKey)
      const modelName = process.env.GEMINI_CLASSIFIER_MODEL || process.env.GEMINI_MODEL || RESUME_PARSE_MODELS[0]
      const model = genAI.getGenerativeModel({ model: modelName })
      const prompt = `You are helping a logistics/transportation job platform.

From the resume text, infer candidate job preferences.
Return ONLY valid JSON with keys:
- preferred_roles: array of 1-5 role titles (strings)
- open_job_types: array containing any of "full_time","part_time","contract" (0-3 items)
- preferred_location: string (city/region) or empty string if unknown

Resume text:
${limited}`

      const genResult: any = await model.generateContent(prompt)
      const content = genResult.response.text()
      const match = content.match(/\{[\s\S]*\}/)
      const parsedPrefs = match ? JSON.parse(match[0]) : null

      const roles = Array.isArray(parsedPrefs?.preferred_roles)
        ? (parsedPrefs.preferred_roles as unknown[]).filter((x) => typeof x === "string").map((x: string) => x.trim()).filter(Boolean).slice(0, 8)
        : []
      const jobTypesRaw = Array.isArray(parsedPrefs?.open_job_types) ? (parsedPrefs.open_job_types as unknown[]) : []
      const jobTypes = Array.from(new Set(jobTypesRaw.map(normalizeJobType).filter(Boolean))) as string[]
      const preferredLocation = typeof parsedPrefs?.preferred_location === "string" ? parsedPrefs.preferred_location.trim() : ""

      const hasRoles = Array.isArray((existingPrefs as any)?.preferred_roles) && (existingPrefs as any).preferred_roles.length
      const hasTypes = Array.isArray((existingPrefs as any)?.open_job_types) && (existingPrefs as any).open_job_types.length
      const hasLoc = typeof (existingPrefs as any)?.preferred_location === "string" && (existingPrefs as any).preferred_location.trim()

      if (!hasRoles && roles.length) candidateUpdate.preferred_roles = roles.slice(0, 5)
      if (!hasTypes && jobTypes.length) candidateUpdate.open_job_types = jobTypes
      if (!hasLoc && preferredLocation) candidateUpdate.preferred_location = preferredLocation
    } catch {
      // Preference inference is a nice-to-have. Never fail the parse over it.
    }
  }

  const tagsMap = tagsToMap((existingPrefs as any)?.tags)
  try {
    const inferred = await inferLogisticsBackground(result.resumeText || "")
    if (!tagsMap.logistics_background) {
      tagsMap.logistics_background = inferred.value
    }
  } catch {
    if (!tagsMap.logistics_background) tagsMap.logistics_background = "no"
  }
  candidateUpdate.tags = mapToTags(tagsMap)

  const { data: updatedCandidate, error: candErr } = await supabaseAdmin
    .from("candidates")
    .update(candidateUpdate)
    .eq("id", candidateId)
    .select("id")
    .single()

  if (candErr || !updatedCandidate) throw new Error("Failed to update candidate")

  // Only replace work_experience / education when we actually got rows, so
  // a partial parse never wipes data that was already there.
  if (result.workExperience.length) {
    await supabaseAdmin.from("work_experience").delete().eq("candidate_id", candidateId)
    const rows = result.workExperience.map((r) => ({ ...r, candidate_id: candidateId, created_at: nowIso() }))
    await supabaseAdmin.from("work_experience").insert(rows as any)
  }

  if (result.education.length) {
    await supabaseAdmin.from("education").delete().eq("candidate_id", candidateId)
    const rows = result.education.map((r) => ({ ...r, candidate_id: candidateId, created_at: nowIso() }))
    await supabaseAdmin.from("education").insert(rows as any)
  }

  await supabaseAdmin
    .from("parsing_jobs")
    .update({
      status: result.state === "needs_review" ? "failed" : "completed",
      parsing_method: parsingMethod,
      error: result.error ?? null,
      completed_at: nowIso(),
    })
    .eq("id", parsingJobId)
    .eq("candidate_id", candidateId)

  //
  // A resume we could not read is not a success and not a silent drop. The
  // candidate is flagged "needs_review" and the job stays queued for another
  // attempt, so the recruiter can see it needs a human.
  //
  if (result.state === "needs_review") {
    Sentry.captureMessage("resume needs review", {
      level: "warning",
      tags: { candidate_id: candidateId, workerId },
      extra: { error: result.error },
    })
    throw new Error(result.error || "Could not extract text from resume")
  }

  await supabaseAdmin
    .from("resume_parse_jobs")
    .update({ status: "succeeded", locked_by: workerId, locked_at: nowIso(), updated_at: nowIso(), error: null })
    .eq("id", jobId)
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

/**
 * Release jobs whose worker died holding them.
 *
 * A worker claims a job by flipping it to 'processing'. If the worker is
 * killed mid-parse — a deploy, an OOM, a laptop closing — the job stays
 * 'processing' forever. The claim RPC only ever picks 'queued' rows, so
 * the queue looks empty while jobs sit locked, and those candidates are
 * never parsed again. That is exactly how a resume ends up stuck: the
 * file is uploaded, the job is claimed, and then nothing happens to it
 * ever again.
 *
 * Anything locked for longer than STALE_LOCK_MINUTES goes back to 'queued'
 * so another worker can pick it up.
 */
const STALE_LOCK_MINUTES = 15

async function releaseStaleLocks(workerId: string) {
  const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from("resume_parse_jobs")
    .update({
      status: "queued",
      locked_by: null,
      locked_at: null,
      next_run_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq("status", "processing")
    .lt("locked_at", cutoff)
    .select("id")

  if (error) {
    console.error("releaseStaleLocks failed", error.message)
    return 0
  }
  const n = data?.length || 0
  if (n > 0) {
    console.log(`resume worker released ${n} stale locked job(s) (${workerId})`)
  }
  return n
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
  // Polling too aggressively will hammer Supabase even when there is no work.
  // Use an adaptive backoff loop: fast when jobs exist, slower when idle.
  const basePollMs = Math.min(60_000, Math.max(2_000, Number(process.env.WORKER_POLL_MS || 15_000)))
  const maxIdlePollMs = Math.min(180_000, Math.max(basePollMs, Number(process.env.WORKER_MAX_IDLE_POLL_MS || 120_000)))
  const maxAttempts = Math.min(10, Math.max(1, Number(process.env.WORKER_MAX_ATTEMPTS || 3)))
  const envReady = Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!envReady) {
    console.error("resume worker missing supabase env. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY")
    Sentry.captureMessage("resume worker missing supabase env", { level: "error" })
  }
  console.log("resume worker started", { workerId, batchSize, basePollMs, maxIdlePollMs, maxAttempts })

  let shouldStop = false
  let idleCycles = 0
  process.on("SIGTERM", () => {
    shouldStop = true
  })
  process.on("SIGINT", () => {
    shouldStop = true
  })

  while (!shouldStop) {
    // Reap jobs whose worker died holding them. This runs on every cycle,
    // so a killed worker never leaves a resume stuck.
    await releaseStaleLocks(workerId)

    const list = await claimJobs(workerId, batchSize)
    if (!list.length) {
      idleCycles += 1
      if (idleCycles % 5 === 0) {
        console.log("resume worker idle", { workerId, idleCycles })
      }
      // Exponential backoff with jitter while idle (caps at maxIdlePollMs)
      const exp = Math.min(6, idleCycles) // 1..6 => up to 64x
      const backoff = Math.min(maxIdlePollMs, basePollMs * Math.pow(2, exp - 1))
      const jitter = Math.floor(Math.random() * Math.min(1000, Math.max(250, Math.floor(backoff * 0.1))))
      await sleep(backoff + jitter)
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

    // Brief pause between batches to reduce tight-looping when queue is hot.
    await sleep(300)
  }
}

run().catch(() => {
  process.exit(1)
})
