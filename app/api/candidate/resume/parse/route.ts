import { NextRequest, NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { uploadFileToSupabase } from "@/lib/supabase-storage-utils"
import { getAuthedUser } from "@/lib/apiServerAuth"

export const runtime = "nodejs"
// Uploading + queueing is fast. Parsing happens in the worker, never in this
// request, so this is only a ceiling for a slow 12MB upload.
export const maxDuration = 60

function nowIso() {
  return new Date().toISOString()
}

function sanitizeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_")
}

function pickParsingMethod() {
  if (process.env.GEMINI_API_KEY) return "gemini"
  if (process.env.OPENROUTER_API_KEY) return "openrouter"
  return "basic"
}

async function getOrCreateCandidateId(authUserId: string, email: string) {
  const { data: existing, error } = await supabaseAdmin
    .from("candidates")
    .select("id,auth_user_id")
    .or(`auth_user_id.eq.${authUserId},email.eq.${email}`)
    .maybeSingle()
  if (error) throw new Error("Failed to load candidate")
  if (existing?.id) {
    if (!existing.auth_user_id) {
      await supabaseAdmin.from("candidates").update({ auth_user_id: authUserId, updated_at: nowIso() }).eq("id", existing.id)
    }
    return existing.id as string
  }

  const baseName = email.split("@")[0]
  const { data: created, error: createErr } = await supabaseAdmin
    .from("candidates")
    .insert({
      auth_user_id: authUserId,
      email,
      name: baseName,
      current_role: "Candidate",
      total_experience: "0",
      location: "Unknown",
      status: "new",
      // The row exists but no resume has been read yet. This state is what
      // lets us tell "candidate who never uploaded" apart from "candidate
      // whose upload failed" — the old code left both looking identical.
      resume_parse_state: "none",
      uploaded_at: nowIso(),
      updated_at: nowIso()
    })
    .select("id")
    .single()

  if (createErr || !created?.id) throw new Error("Failed to create candidate")
  return created.id as string
}

function looksAllowedResume(file: File) {
  const t = String((file as any)?.type || "").toLowerCase()
  if (t === "application/pdf") return true
  if (t === "application/msword") return true
  if (t === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true
  if (t === "text/plain") return true
  const name = String((file as any)?.name || "").toLowerCase()
  return name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx") || name.endsWith(".txt")
}

export async function POST(request: NextRequest) {
  let stage = "init"
  try {
    stage = "auth"
    const { user } = await getAuthedUser(request)
    if (!user) return NextResponse.json({ error: "Unauthorized", stage }, { status: 401 })

    const userEmail = String((user as any)?.email || "").trim().toLowerCase()
    if (!userEmail) return NextResponse.json({ error: "Email required", stage }, { status: 400 })

    stage = "formdata"
    const form = await request.formData()
    const file = form.get("resume") as File | null
    if (!file) return NextResponse.json({ error: "Missing resume", stage }, { status: 400 })
    if (!looksAllowedResume(file)) return NextResponse.json({ error: "Please upload a PDF, DOC/DOCX, or TXT resume.", stage }, { status: 400 })
    if (typeof file.size === "number" && file.size > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "Resume file is too large. Please upload a file under 12MB.", stage }, { status: 400 })
    }

    stage = "candidate"
    const candidateId = await getOrCreateCandidateId(user.id, userEmail)

    stage = "upload"
    const filePath = `${candidateId}/${Date.now()}_${sanitizeName(file.name)}`
    const { url: fileUrl, path } = await uploadFileToSupabase(file, filePath)

    stage = "insert_file_storage"
    const { data: fileRow, error: fileErr } = await supabaseAdmin
      .from("file_storage")
      .insert({
        candidate_id: candidateId,
        file_name: file.name,
        file_url: fileUrl,
        file_size: file.size,
        file_type: file.type || "application/octet-stream",
        original_path: path,
        storage_provider: "supabase",
        created_at: nowIso()
      })
      .select("*")
      .single()

    if (fileErr) {
      console.error("/api/candidate/resume/parse error", { stage, message: fileErr.message })
      return NextResponse.json({ error: `Failed to store file metadata: ${fileErr.message}`, stage }, { status: 500 })
    }

    stage = "update_candidate"
    const { data: updatedCandidate, error: candErr } = await supabaseAdmin
      .from("candidates")
      .update({
        auth_user_id: user.id,
        file_name: file.name,
        file_url: fileUrl,
        file_size: file.size,
        file_type: file.type || "application/octet-stream",
        resume_parse_state: "queued",
        resume_parse_error: null,
        uploaded_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", candidateId)
      .select("*")
      .single()

    if (candErr) {
      console.error("/api/candidate/resume/parse error", { stage, message: candErr.message })
      return NextResponse.json({ error: `Failed to update candidate: ${candErr.message}`, stage }, { status: 500 })
    }

    stage = "create_parsing_job"
    const { data: parsingJob, error: pErr } = await supabaseAdmin
      .from("parsing_jobs")
      .insert({
        candidate_id: candidateId,
        file_id: fileRow.id,
        status: "pending",
        parsing_method: pickParsingMethod(),
        created_at: nowIso()
      })
      .select("*")
      .single()

    if (pErr || !parsingJob) {
      console.error("/api/candidate/resume/parse error", { stage, message: pErr?.message || "Missing parsingJob" })
      return NextResponse.json({ error: `Failed to create parsing job: ${pErr?.message || "Unknown error"}`, stage }, { status: 500 })
    }

    stage = "enqueue"
    //
    // Hand the parse to the background worker and return immediately.
    //
    // Parsing a resume means OCR + one or more LLM calls and routinely takes
    // 10–60 seconds. Doing it inline is what produced the "Failed to fetch"
    // candidates were reporting: the serverless function hit its wall-clock
    // limit and the connection was cut before a response was written, so the
    // browser surfaced a bare network error even though the file had already
    // been uploaded. The file is safely in storage at this point; the worker
    // (or the status endpoint's fallback parser) finishes the job.
    const { error: queueErr } = await supabaseAdmin.from("resume_parse_jobs").insert({
      candidate_id: candidateId,
      parsing_job_id: parsingJob.id,
      file_id: fileRow.id,
      file_path: path,
      status: "queued",
      attempts: 0,
      next_run_at: nowIso(),
      created_at: nowIso(),
      updated_at: nowIso(),
    })

    if (queueErr) {
      // Do not fail the upload: the resume is stored and the status endpoint's
      // fallback parser claims any parsing_job that has no active queue row.
      console.error("/api/candidate/resume/parse enqueue failed", { message: queueErr.message })
      Sentry.captureException(queueErr, { tags: { stage: "enqueue", candidate_id: candidateId } })
    }

    return NextResponse.json({
      candidate: updatedCandidate,
      parsingJob,
      // The client polls /api/candidate/resume/status until this job finishes.
      parseState: "queued",
      parseError: null,
    })

  } catch (e: any) {
    const message = typeof e?.message === "string" && e.message.trim() ? e.message.trim() : "Internal Server Error"
    console.error("/api/candidate/resume/parse error", { stage, message })
    Sentry.captureException(e, { tags: { stage } })
    return NextResponse.json({ error: message, stage }, { status: 500 })
  }
}
