import { NextRequest, NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { uploadFileToSupabase } from "@/lib/supabase-storage-utils"
import { getAuthedUser } from "@/lib/apiServerAuth"
import { ingestResume } from "@/lib/resume-ingest"

export const runtime = "nodejs"

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
        resume_parse_state: "parsing",
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
        status: "processing",
        parsing_method: pickParsingMethod(),
        created_at: nowIso(),
        started_at: nowIso()
      })
      .select("*")
      .single()

    if (pErr || !parsingJob) {
      console.error("/api/candidate/resume/parse error", { stage, message: pErr?.message || "Missing parsingJob" })
      return NextResponse.json({ error: `Failed to create parsing job: ${pErr?.message || "Unknown error"}`, stage }, { status: 500 })
    }

    stage = "ingest"
    //
    // One ingestion path for every resume. It never throws for a parse
    // failure — it returns what it managed to extract plus a state, so a
    // resume is never thrown away because the LLM had a bad minute.
    const result = await ingestResume(file)

    const candidateUpdate: Record<string, unknown> = {
      ...result.fields,
      file_name: file.name,
      file_url: fileUrl,
      file_size: file.size,
      file_type: file.type || "application/octet-stream",
      parsing_method: pickParsingMethod(),
      resume_parse_state: result.state,
      resume_parse_error: result.error ?? null,
      uploaded_at: nowIso(),
      updated_at: nowIso(),
    }

    const { data: updated2, error: updErr } = await supabaseAdmin
      .from("candidates")
      .update(candidateUpdate)
      .eq("id", candidateId)
      .select("*")
      .single()

    if (updErr) {
      console.error("/api/candidate/resume/parse error", { stage: "write_candidate", message: updErr.message })
      return NextResponse.json({ error: `Failed to save parsed resume: ${updErr.message}`, stage }, { status: 500 })
    }

    // Work experience / education — only replace when we actually got rows.
    // The old code deleted the existing rows first and then inserted, so a
    // partial parse wiped good data that was already there.
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

    //
    // A candidate whose resume could not be read is NOT dropped. The file
    // stays, the state is "needs_review", and we enqueue a background retry
    // so a human (or a later worker run) can pick it up. This is the
    // difference between "0% failure" and "the resume vanished".
    //
    if (result.state === "needs_review") {
      Sentry.captureMessage("resume needs review", {
        level: "warning",
        tags: { candidate_id: candidateId },
        extra: { error: result.error },
      })

      const { data: retryJob } = await supabaseAdmin
        .from("parsing_jobs")
        .insert({
          candidate_id: candidateId,
          file_id: fileRow.id,
          status: "pending",
          parsing_method: pickParsingMethod(),
          error: result.error || "Could not extract text",
          created_at: nowIso(),
        })
        .select("id")
        .maybeSingle()

      if (retryJob?.id) {
        // Enqueue for the background worker.
        //
        // The dedupe index is PARTIAL (only active rows), which PostgREST's
        // ON CONFLICT inference cannot target — so we check explicitly
        // instead of upserting. This keeps a double-submit from stacking up
        // queue rows for the same file.
        const { data: alreadyQueued } = await supabaseAdmin
          .from("resume_parse_jobs")
          .select("id")
          .eq("candidate_id", candidateId)
          .eq("file_id", fileRow.id)
          .in("status", ["queued", "processing"])
          .maybeSingle()

        if (!alreadyQueued) {
          await supabaseAdmin.from("resume_parse_jobs").insert({
            candidate_id: candidateId,
            parsing_job_id: retryJob.id,
            file_id: fileRow.id,
            file_path: path,
            status: "queued",
            attempts: 0,
            next_run_at: nowIso(),
            created_at: nowIso(),
            updated_at: nowIso(),
          })
        }
      }
    }

    await supabaseAdmin
      .from("parsing_jobs")
      .update({
        status: result.state === "needs_review" ? "failed" : "completed",
        error: result.error ?? null,
        completed_at: nowIso(),
      })
      .eq("id", parsingJob.id)

    // The status endpoint polls this job, so keep it consistent.
    const finalJob = {
      ...parsingJob,
      status: result.state === "needs_review" ? "failed" : "completed",
      error: result.error ?? null,
      completed_at: nowIso(),
    }

    return NextResponse.json({
      candidate: updated2,
      parsingJob: finalJob,
      // The client uses this to tell the candidate what is really going on
      // instead of showing "Parsing status: failed" and going quiet.
      parseState: result.state,
      parseError: result.error ?? null,
    })
  } catch (e: any) {
    const message = typeof e?.message === "string" && e.message.trim() ? e.message.trim() : "Internal Server Error"
    console.error("/api/candidate/resume/parse error", { stage, message })
    Sentry.captureException(e, { tags: { stage } })
    return NextResponse.json({ error: message, stage }, { status: 500 })
  }
}
