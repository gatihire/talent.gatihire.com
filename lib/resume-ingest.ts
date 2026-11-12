/**
 * Resume ingestion — the single path every resume goes through.
 *
 * WHY THIS EXISTS
 *
 * Before this module there were three separate implementations of "parse a
 * resume and write the candidate" (the sync apply route, the API fallback in
 * the status route, and the queue worker). Each one had the same defects:
 *
 *   1. They all threw away the resume text when the STRUCTURED parse failed.
 *      A scanned PDF or an unusual layout produced "Failed to extract valid
 *      candidate information from resume" and the candidate row was left
 *      with NO resume_text — even though the PDF had perfectly readable
 *      text in it. The resume was there; we just refused to keep it.
 *
 *   2. Only two of the three wrote an embedding. The public apply path —
 *      the one real candidates actually use — never wrote one, so every
 *      candidate who applied through the site was invisible to vector
 *      search.
 *
 *   3. A transient Gemini 429 silently degraded to a regex parser that then
 *      failed validation, and the job was marked "failed" with no retry.
 *      A rate limit became a permanent hole in the candidate database.
 *
 *   4. The candidate row was created BEFORE the file was uploaded, so a
 *      failed upload left a permanently empty candidate.
 *
 * THE CONTRACT
 *
 * `ingestResume` NEVER loses a resume. It always returns whatever text it
 * could extract, plus a state describing how complete the parse was:
 *
 *   parsed       - structured fields extracted and written
 *   partial      - text extracted, structured fields incomplete. The text
 *                  IS saved. A recruiter can read it; a retry may improve it.
 *   needs_review - no usable text at all (scanned image PDF, corrupt file).
 *                  The file is kept and the candidate is flagged for a human.
 *
 * Nothing is ever written as `resume_text = ""`. If we have text, we keep it.
 */

import { parseResume, extractTextFromFile } from "./resume-parser"
import { generateEmbedding } from "./embedding"
import { normalizePhone } from "./phone"

export type ResumeParseState = "parsed" | "partial" | "needs_review"

export type IngestResult = {
  state: ResumeParseState
  /** Everything worth writing onto the candidate row. */
  fields: Record<string, unknown>
  /** Raw resume text, or "" if we could not extract any. */
  resumeText: string
  /** Rows for the work_experience table (may be empty). */
  workExperience: Array<Record<string, unknown>>
  /** Rows for the education table (may be empty). */
  education: Array<Record<string, unknown>>
  /** True when the embedding was generated and is ready to store. */
  hasEmbedding: boolean
  /** Human-readable reason, for needs_review / partial. */
  error?: string
}

/** Values that mean "we have nothing here". */
function isBlank(v: unknown): boolean {
  if (v == null) return true
  const t = String(v).trim().toLowerCase()
  if (!t) return true
  return (
    t === "unknown" ||
    t === "unknown name" ||
    t === "not specified" ||
    t === "n/a" ||
    t === "na" ||
    t === "none" ||
    t === "-"
  )
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  if (isBlank(t)) return null
  return t
}

function cleanStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const cleaned = v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && !isBlank(x))
  return cleaned.length ? cleaned : null
}

/**
 * The text we hand to the embedding model.
 *
 * Same shape as the worker's buildEmbeddingInput, but kept here so every
 * caller produces an identical vector for the same candidate.
 */
export function buildEmbeddingInput(fields: Record<string, unknown>): string {
  const parts = [
    fields.current_role,
    fields.current_company,
    fields.location,
    fields.summary,
    fields.resume_text,
  ]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
  return parts.join("\n")
}

/**
 * Pull the resume text out of a file WITHOUT attempting the structured
 * parse. This is the safety net: if the LLM parse fails we still keep the
 * text, so the candidate is never empty and the resume is never lost.
 *
 * Returns "" only when the file genuinely has no extractable text.
 */
async function extractRawTextOnly(file: any): Promise<string> {
  try {
    const text = await extractTextFromFile(file)
    if (!text) return ""
    // The extractor returns error markers instead of throwing.
    if (/^error extracting text from|^doc processing error:/i.test(text.trim())) return ""
    return text
  } catch (e: any) {
    console.warn("[resume-ingest] raw text extraction failed:", e?.message || e)
    return ""
  }
}

/**
 * Parse a resume and build everything we want to write to the candidate row.
 *
 * `file` must expose name / type / arrayBuffer (or text).
 */
export async function ingestResume(file: any): Promise<IngestResult> {
  const fields: Record<string, unknown> = {}
  let structured: any = null
  let parseError: string | undefined

  // --- Attempt 1: the full structured parse -----------------------------
  try {
    structured = await parseResume(file)
  } catch (e: any) {
    parseError = String(e?.message || e || "Resume parsing failed")
    console.warn("[resume-ingest] structured parse failed:", parseError)
  }

  let resumeText = ""
  if (structured) {
    resumeText = cleanString(structured.resumeText) || ""
  }

  // --- Attempt 2: rescue the text if the structured parse failed ---------
  //
  // This is the fix for "the resume is there but parsing fails": we keep the
  // text even when we cannot structure it.
  if (!resumeText) {
    resumeText = await extractRawTextOnly(file)
  }

  // Nothing readable at all.
  if (!resumeText || resumeText.length < 50) {
    return {
      state: "needs_review",
      fields,
      resumeText: resumeText || "",
      workExperience: [],
      education: [],
      hasEmbedding: false,
      error:
        parseError ||
        "No readable text could be extracted from this file. It may be a scanned image or a corrupt document.",
    }
  }

  // --- Map structured fields onto the candidate columns ------------------
  if (structured) {
    const name = cleanString(structured.name)
    if (name) fields.name = name

    const phoneRaw = cleanString(structured.phone)
    if (phoneRaw) {
      const phone = normalizePhone(phoneRaw)
      if (phone) {
        fields.phone = phone
        fields.phone_e164 = phone
      }
    }

    const map: Array<[string, string]> = [
      ["currentRole", "current_role"],
      ["currentCompany", "current_company"],
      ["location", "location"],
      ["totalExperience", "total_experience"],
      ["highestQualification", "highest_qualification"],
      ["degree", "degree"],
      ["specialization", "specialization"],
      ["university", "university"],
      ["educationYear", "education_year"],
      ["educationPercentage", "education_percentage"],
      ["additionalQualifications", "additional_qualifications"],
      ["summary", "summary"],
    ]
    for (const [src, dst] of map) {
      const v = cleanString(structured[src])
      if (v) fields[dst] = v
    }

    const arrays: Array<[string, string]> = [
      ["technicalSkills", "technical_skills"],
      ["softSkills", "soft_skills"],
      ["languagesKnown", "languages_known"],
      ["certifications", "certifications"],
      ["previousCompanies", "previous_companies"],
      ["jobTitles", "job_titles"],
      ["workDuration", "work_duration"],
      ["keyAchievements", "key_achievements"],
      ["projects", "projects"],
    ]
    for (const [src, dst] of arrays) {
      const v = cleanStringArray(structured[src])
      if (v) fields[dst] = v
    }
  }

  fields.resume_text = resumeText

  // --- Work experience / education rows ---------------------------------
  const workExperience: Array<Record<string, unknown>> = []
  if (Array.isArray(structured?.workExperience)) {
    for (const it of structured.workExperience as any[]) {
      const company = cleanString(it?.company)
      const role = cleanString(it?.role)
      if (!company && !role) continue
      const responsibilities = Array.isArray(it?.responsibilities)
        ? it.responsibilities.map((x: any) => String(x).trim()).filter(Boolean).join("\n")
        : cleanString(it?.responsibilities)
      const achievements = Array.isArray(it?.achievements)
        ? it.achievements.map((x: any) => String(x).trim()).filter(Boolean).join("\n")
        : cleanString(it?.achievements)
      workExperience.push({
        company: company || "Not specified",
        role: role || "Not specified",
        duration: cleanString(it?.duration) || "Not specified",
        location: cleanString(it?.location),
        description: cleanString(it?.description),
        responsibilities,
        achievements,
        technologies: cleanStringArray(it?.technologies),
      })
    }
  }

  const education: Array<Record<string, unknown>> = []
  if (Array.isArray(structured?.education)) {
    for (const it of structured.education as any[]) {
      const degree = cleanString(it?.degree)
      const institution = cleanString(it?.institution) || cleanString(it?.university)
      if (!degree && !institution) continue
      education.push({
        degree: degree || "Not specified",
        specialization: cleanString(it?.specialization),
        institution: institution || "Not specified",
        year: cleanString(it?.year) || cleanString(it?.endYear) || cleanString(it?.educationYear),
        percentage: cleanString(it?.percentage),
        description: cleanString(it?.description),
      })
    }
  }

  // --- Embedding ---------------------------------------------------------
  //
  // ALWAYS attempt this. The old public apply path skipped it entirely,
  // which is why candidates who applied through the site were invisible to
  // vector search.
  let hasEmbedding = false
  try {
    const input = buildEmbeddingInput(fields)
    const expectedDim = Number(process.env.EMBEDDING_DIM || 768)
    const embedding = await generateEmbedding(input)
    if (Array.isArray(embedding) && embedding.length === expectedDim) {
      fields.embedding = embedding
      hasEmbedding = true
    } else if (Array.isArray(embedding) && embedding.length > 0) {
      console.warn(
        `[resume-ingest] embedding dim ${embedding.length} != expected ${expectedDim}; skipping`,
      )
    }
  } catch (e: any) {
    console.warn("[resume-ingest] embedding generation failed:", e?.message || e)
  }

  // --- Verdict ------------------------------------------------------------
  //
  // "parsed" means the structured parse produced a usable candidate.
  // Otherwise we still have the text and the profile is "partial" — much
  // better than an empty candidate, and a recruiter can read the resume.
  const structuredUsable =
    !!structured && !!cleanString(structured.name) && !!cleanString(structured.currentRole)

  return {
    state: structuredUsable ? "parsed" : "partial",
    fields,
    resumeText,
    workExperience,
    education,
    hasEmbedding,
    error: structuredUsable ? undefined : parseError,
  }
}
