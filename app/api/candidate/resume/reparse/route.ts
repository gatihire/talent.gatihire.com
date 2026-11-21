import { NextRequest, NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getAuthedUser } from "@/lib/apiServerAuth"
import { RESUME_BUCKET } from "@/lib/constants/storage"
import { ingestResume } from "@/lib/resume-ingest"
import {
  writeIngestToCandidate,
  finalizeParsingJob,
  getCandidateRow,
  downloadResumeAsFile,
} from "@/lib/resume-upload"

export const runtime = "nodejs"
// The parse runs inline in this request (there is no background worker), so
// this is a wall-clock ceiling for OCR + one or more model calls.
export const maxDuration = 60

function nowIso() {
  return new Date().toISOString()
}

function pickParsingMethod() {
  if (process.env.GEMINI_API_KEY) return "gemini"
  if (process.env.OPENROUTER_API_KEY) return "openrouter"
  return "basic"
}

function extractPathFromPublicUrl(url: string) {
  const marker = `/storage/v1/object/public/${RESUME_BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return ""
  return url.slice(idx + marker.length)
}

export async function POST(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userEmail = String((user as any)?.email || "").trim().toLowerCase()
  const { data: candidate, error: cErr } = await supabaseAdmin
    .from("candidates")
    .select("id,email,file_url,name,phone")
    .or(`auth_user_id.eq.${user.id},email.eq.${userEmail}`)
    .maybeSingle()

  if (cErr) return NextResponse.json({ error: "Failed to load candidate" }, { status: 500 })
  if (!candidate?.id) return NextResponse.json({ error: "Candidate not found" }, { status: 404 })

  const candidateId = String(candidate.id)

  const { data: fileRow } = await supabaseAdmin
    .from("file_storage")
    .select("id,original_path,file_url,file_name,file_type,file_size")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!fileRow) {
    return NextResponse.json({ error: "No file record found" }, { status: 404 })
  }

  const fileId = fileRow?.id ? String(fileRow.id) : ""
  const filePath = fileRow?.original_path
    ? String(fileRow.original_path)
    : candidate?.file_url
      ? extractPathFromPublicUrl(String(candidate.file_url))
      : ""

  if (!fileId || !filePath) {
    return NextResponse.json(
      { error: "No uploaded resume found to parse. Please upload a resume again." },
      { status: 400 },
    )
  }

  const { data: parsingJob, error: pErr } = await supabaseAdmin
    .from("parsing_jobs")
    .insert({
      candidate_id: candidateId,
      file_id: fileId,
      status: "processing",
      parsing_method: pickParsingMethod(),
      started_at: nowIso(),
      created_at: nowIso(),
    })
    .select("*")
    .single()

  if (pErr || !parsingJob) {
    return NextResponse.json({ error: pErr?.message || "Failed to create parsing job" }, { status: 500 })
  }

  // Re-read the stored file and parse it here, in this request. Enqueuing to
  // the Fly worker meant "re-parse my resume" silently did nothing whenever
  // that worker was not running, leaving the job pending forever.
  let parseResult: any = null
  let parseError: string | null = null

  try {
    const { file } = await downloadResumeAsFile(
      filePath,
      typeof fileRow.file_url === "string" ? fileRow.file_url : null,
      String(fileRow.file_name || "resume"),
      typeof fileRow.file_type === "string" ? fileRow.file_type : null,
    )
    parseResult = await ingestResume(file)
  } catch (e: any) {
    parseError = e?.message || "Resume parsing failed"
    console.error("/api/candidate/resume/reparse inline parse error", { parseError })
    Sentry.captureException(e, { tags: { stage: "reparse", candidate_id: candidateId } })
  }

  const write = await writeIngestToCandidate(
    candidateId,
    {
      name: String(fileRow.file_name || "resume"),
      type: typeof fileRow.file_type === "string" ? fileRow.file_type : null,
      size: typeof fileRow.file_size === "number" ? fileRow.file_size : null,
      url: typeof fileRow.file_url === "string" ? fileRow.file_url : null,
    },
    parseResult,
    parseError,
  )

  const finalJob = await finalizeParsingJob(
    String(parsingJob.id),
    write.state,
    write.error || parseError || parseResult?.error || null,
  )

  const freshCandidate = await getCandidateRow(candidateId)

  return NextResponse.json({
    candidate: freshCandidate,
    parsingJob:
      finalJob || {
        ...parsingJob,
        status: write.state === "needs_review" ? "failed" : "completed",
      },
    parseState: write.state,
    parseError: write.error || parseError || parseResult?.error || null,
  })
}
