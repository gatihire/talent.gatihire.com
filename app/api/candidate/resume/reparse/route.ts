import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getAuthedUser } from "@/lib/apiServerAuth"
import { RESUME_BUCKET } from "@/lib/constants/storage"

export const runtime = "nodejs"

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
    .select("id,original_path,file_url,file_name,file_type")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!fileRow) {
    return NextResponse.json({ error: "No file record found" }, { status: 404 })
  }

  const fileId = fileRow?.id ? String(fileRow.id) : ""
  const filePath = fileRow?.original_path ? String(fileRow.original_path) : candidate?.file_url ? extractPathFromPublicUrl(String(candidate.file_url)) : ""

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
      status: "pending",
      parsing_method: pickParsingMethod(),
      created_at: nowIso(),
    })
    .select("*")
    .single()

  if (pErr || !parsingJob) return NextResponse.json({ error: pErr?.message || "Failed to create parsing job" }, { status: 500 })

  const { error: queueErr } = await supabaseAdmin
    .from("resume_parse_jobs")
    .insert({
      candidate_id: candidateId,
      parsing_job_id: parsingJob.id,
      file_id: fileId,
      file_path: filePath,
      status: "queued",
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    .select("id")
    .single()

  if (queueErr) return NextResponse.json({ error: queueErr.message || "Failed to enqueue parsing job" }, { status: 500 })
  return NextResponse.json({ parsingJob })
}
