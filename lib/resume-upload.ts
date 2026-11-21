/**
 * Shared plumbing for the two resume endpoints.
 *
 * Both `/api/candidate/resume/parse` (a fresh upload) and
 * `/api/candidate/resume/reparse` (re-read the file already in storage) have to
 * do exactly the same thing after the parse finishes:
 *
 *   - write every field the ingest step produced onto the candidate row,
 *   - write the child work-experience / education rows,
 *   - record whether the parse was complete, partial, or unreadable.
 *
 * Keeping that in one place matters because these two routes used to drift:
 * one wrote the child rows, the other did not, and a candidate who re-parsed
 * their resume ended up with an emptier profile than before.
 */

import { supabaseAdmin } from "./supabaseAdmin"
import { RESUME_BUCKET } from "./constants/storage"
import type { IngestResult } from "./resume-ingest"

export type ResumeParseState = "parsed" | "partial" | "needs_review"

export type ResumeFileMeta = {
  name: string
  type: string | null
  size: number | null
  /** Public URL, used as a fallback if the storage object cannot be read. */
  url: string | null
}

export type WriteOutcome = {
  state: ResumeParseState
  /** Non-null only when the write itself failed or the file was unreadable. */
  error: string | null
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeState(state: unknown): ResumeParseState {
  return state === "parsed" || state === "partial" || state === "needs_review" ? state : "needs_review"
}

/**
 * Write an ingest result onto the candidate row.
 *
 * NEVER throws: the file is already stored by the time this runs, so a write
 * failure must not turn a saved upload into an error response. It is reported
 * as `needs_review` instead so a recruiter can pick it up.
 */
export async function writeIngestToCandidate(
  candidateId: string,
  meta: ResumeFileMeta,
  result: IngestResult | null,
  parseError: string | null,
): Promise<WriteOutcome> {
  const state = normalizeState(result?.state)

  const baseUpdate: Record<string, unknown> = {
    file_name: meta.name,
    file_url: meta.url,
    file_size: meta.size,
    file_type: meta.type || "application/octet-stream",
    uploaded_at: nowIso(),
    updated_at: nowIso(),
  }

  if (state === "needs_review" || !result) {
    const { error } = await supabaseAdmin
      .from("candidates")
      .update({
        ...baseUpdate,
        resume_parse_state: "needs_review",
        resume_parse_error:
          parseError || result?.error || "Could not extract text from this resume",
      })
      .eq("id", candidateId)

    if (error) {
      console.error("[resume-upload] candidate write failed", { candidateId, message: error.message })
      return { state: "needs_review", error: error.message }
    }
    return { state: "needs_review", error: parseError || result?.error || null }
  }

  const update: Record<string, unknown> = {
    ...baseUpdate,
    ...(result.fields || {}),
    resume_parse_state: state,
    resume_parse_error: state === "partial" ? result.error || null : null,
  }
  if (result.resumeText) update.resume_text = result.resumeText

  const { error } = await supabaseAdmin.from("candidates").update(update).eq("id", candidateId)
  if (error) {
    console.error("[resume-upload] candidate write failed", { candidateId, message: error.message })
    return { state: "needs_review", error: error.message }
  }

  // Child rows. The profile's "experience" and "education" sections read these
  // tables, so leaving them out makes a well-parsed resume look half-empty.
  if (Array.isArray(result.workExperience) && result.workExperience.length) {
    await supabaseAdmin.from("work_experience").delete().eq("candidate_id", candidateId)
    const { error: wErr } = await supabaseAdmin.from("work_experience").insert(
      result.workExperience.map((it) => ({ ...it, candidate_id: candidateId, created_at: nowIso() })),
    )
    if (wErr) console.warn("[resume-upload] work_experience write failed", { message: wErr.message })
  }

  if (Array.isArray(result.education) && result.education.length) {
    await supabaseAdmin.from("education").delete().eq("candidate_id", candidateId)
    const { error: eErr } = await supabaseAdmin.from("education").insert(
      result.education.map((it) => ({ ...it, candidate_id: candidateId, created_at: nowIso() })),
    )
    if (eErr) console.warn("[resume-upload] education write failed", { message: eErr.message })
  }

  return { state, error: null }
}

/**
 * Load a resume that is already in storage as a File-like object, so it can be
 * handed to `ingestResume`.
 */
export async function downloadResumeAsFile(
  filePath: string,
  fallbackUrl: string | null,
  fileName: string,
  fileType: string | null,
): Promise<{ file: any; blob: Blob; name: string; type: string }> {
  let blob: Blob | null = null

  if (filePath) {
    const { data, error } = await supabaseAdmin.storage.from(RESUME_BUCKET).download(filePath)
    if (!error && data) blob = data as unknown as Blob
  }

  if (!blob && fallbackUrl) {
    const res = await fetch(fallbackUrl)
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
    blob = await res.blob()
  }

  if (!blob) throw new Error("Could not read the stored resume file")

  const name = fileName || "resume"
  const type = (blob as any)?.type || fileType || "application/octet-stream"

  const g: any = globalThis as any
  const file =
    typeof g.File === "function"
      ? new g.File([blob], name, { type })
      : { name, type, arrayBuffer: async () => await blob!.arrayBuffer() }

  return { file, blob, name, type }
}

/**
 * Close a `parsing_jobs` row.
 *
 * The client polls `/api/candidate/resume/status` until the row reaches a
 * terminal status. When the parse runs inline, the row must be closed by the
 * same request — leaving it "pending" is what made a successful upload sit on
 * the resume step forever and look like a failure.
 */
export async function finalizeParsingJob(
  parsingJobId: string,
  state: ResumeParseState,
  error: string | null,
) {
  const status = state === "needs_review" ? "failed" : "completed"
  const { data, error: dbErr } = await supabaseAdmin
    .from("parsing_jobs")
    .update({
      status,
      parsing_method: "inline",
      error_message: state === "needs_review" ? error || "Could not read this resume" : null,
      started_at: nowIso(),
      completed_at: nowIso(),
    })
    .eq("id", parsingJobId)
    .select("*")
    .single()

  if (dbErr) {
    console.warn("[resume-upload] parsing job finalize failed", { parsingJobId, message: dbErr.message })
    return null
  }
  return data
}

export async function getCandidateRow(candidateId: string) {
  const { data } = await supabaseAdmin.from("candidates").select("*").eq("id", candidateId).single()
  return data || null
}
