import { NextRequest, NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { uploadFileToSupabase } from "@/lib/supabase-storage-utils"
import { getAuthedUser } from "@/lib/apiServerAuth"
import { ingestResume } from "@/lib/resume-ingest"

export const runtime = "nodejs"
// Inline parse within the request (maxDuration = 60). When the Fly worker
// board-worker is not running, this route handles the full parse so candidates
// aren't left with a "queued" job that never completes.
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

    stage = "parse_resume"
    //
    // Parse the resume inline instead of enqueuing to the Fly worker.
    // The worker is optional — when it's not running, this route handles
    // the full parse within the serverless function (maxDuration = 60s).
    // On Vercel Pro the 10‑minute limit is generous; on Hobby the 60‑second
    // cap is enough because the Gemini model fixes (retired gemini-2.0-flash)
    // and the raw‑text fallback keep parsing fast for most resumes.
    //
    let parseResult: any = null
    let parseError: string | null = null

    try {
      parseResult = await ingestResume(file)
    } catch (e: any) {
      parseError = e?.message || "Resume parsing failed"
      console.error("/api/candidate/resume/parse inline parse error", { parseError })
    }

    // Map the parse result to candidate fields
    const fields: Record<string, unknown> = {}
    if (parseResult) {
      // Copy over whatever fields the ingest function extracted
      if (parseResult.fields) {
        Object.assign(fields, parseResult.fields)
      }
      if (parseResult.resumeText) {
        fields.resume_text = parseResult.resumeText
      }
    }

    // If we have parsed data, promote the candidate; otherwise flag for review
    if (parseResult?.state === "needs_review" || !parseResult) {
      // Resume could not be fully read — keep the file and flag for recruiter review
      await supabaseAdmin
        .from("candidates")
        .update({
          file_name: file.name,
          file_url: fileUrl,
          file_size: file.size,
          file_type: file.type || "application/octet-stream",
          resume_parse_state: "needs_review",
          resume_parse_error: parseError || "Could not extract text from this resume",
          uploaded_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq("id", candidateId)
    } else {
      // Successful parse — write extracted fields to the candidate row
      const update: Record<string, unknown> = {
        file_name: file.name,
        file_url: fileUrl,
        file_size: file.size,
        file_type: file.type || "application/octet-stream",
        resume_parse_state: "parsed",
        resume_parse_error: null,
        uploaded_at: nowIso(),
        updated_at: nowIso(),
      }
      Object.assign(update, fields)
      await supabaseAdmin
        .from("candidates")
        .update(update)
        .eq("id", candidateId)
    }

    // Return the parsed state to the client
    const response = {
      candidate: await supabaseAdmin
        .from("candidates")
        .select("*")
        .eq("id", candidateId)
        .single(),
      parseState: parseResult?.state || "needs_review",
      parseError: parseError || null,
    }

    return NextResponse.json(response)

  } catch (e: any) {
    const message = typeof e?.message === "string" && e.message.trim() ? e.message.trim() : "Internal Server Error"
    console.error("/api/candidate/resume/parse error", { stage, message })
    Sentry.captureException(e, { tags: { stage } })
    return NextResponse.json({ error: message, stage }, { status: 500 })
  }
}
