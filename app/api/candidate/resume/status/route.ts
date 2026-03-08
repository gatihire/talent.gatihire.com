import { NextRequest, NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getAuthedUser } from "@/lib/apiServerAuth"
import { RESUME_BUCKET } from "@/lib/constants/storage"
import { parseResume } from "@/lib/resume-parser"
import { generateEmbedding } from "@/lib/embedding"

export const runtime = "nodejs"

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

async function runFallbackParsing(parsingJob: any, candidateId: string) {
  const fileId = String(parsingJob.file_id)
  const { data: fileRow, error: fErr } = await supabaseAdmin
    .from("file_storage")
    .select("id,file_name,file_url,file_type,file_size,original_path")
    .eq("id", fileId)
    .eq("candidate_id", candidateId)
    .single()
  if (fErr || !fileRow) throw new Error("File metadata not found")

  const fileName = String(fileRow.file_name || "resume")
  const fileType = typeof fileRow.file_type === "string" ? fileRow.file_type : null
  const storagePath = String(fileRow.original_path || "")
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
    parsing_method: "api_fallback",
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

  if (resumeText) {
    try {
      const embedding = await generateEmbedding(resumeText)
      const expectedDim = Number(process.env.EMBEDDING_DIM || 768)
      if (Array.isArray(embedding) && embedding.length === expectedDim) {
        candidateUpdate.embedding = embedding
      }
    } catch {
    }
  }

  const { error: candErr } = await supabaseAdmin
    .from("candidates")
    .update(candidateUpdate)
    .eq("id", candidateId)
  if (candErr) throw new Error("Failed to update candidate")

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
}

export async function GET(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("parsing_job_id")
  if (!id) return NextResponse.json({ error: "Missing parsing_job_id" }, { status: 400 })

  const userEmail = String((user as any)?.email || "").trim().toLowerCase()
  const { data: candidate } = await supabaseAdmin
    .from("candidates")
    .select("id")
    .or(`auth_user_id.eq.${user.id},email.eq.${userEmail}`)
    .maybeSingle()
  if (!candidate?.id) return NextResponse.json({ error: "Candidate not found" }, { status: 404 })

  const { data: job, error } = await supabaseAdmin
    .from("parsing_jobs")
    .select("*")
    .eq("id", id)
    .eq("candidate_id", candidate.id)
    .single()

  if (error) return NextResponse.json({ error: "Parsing job not found" }, { status: 404 })
  const fallbackDisabled = process.env.RESUME_PARSE_FALLBACK_DISABLED === "1"
  const fallbackAfterMs = Math.max(60_000, Number(process.env.RESUME_PARSE_FALLBACK_MS || 180_000))
  const createdAt = typeof (job as any)?.created_at === "string" ? new Date((job as any).created_at).getTime() : 0
  const ageMs = createdAt ? Date.now() - createdAt : 0
  const shouldFallback = !fallbackDisabled && ageMs > fallbackAfterMs && (job as any)?.status !== "completed" && (job as any)?.status !== "failed"
  if (shouldFallback) {
    const { data: queueRow } = await supabaseAdmin
      .from("resume_parse_jobs")
      .select("*")
      .eq("parsing_job_id", id)
      .eq("candidate_id", candidate.id)
      .maybeSingle()
    const canClaim = !queueRow || (queueRow as any).status === "queued"
    if (canClaim) {
      await supabaseAdmin
        .from("parsing_jobs")
        .update({ status: "processing", updated_at: nowIso() })
        .eq("id", id)
        .eq("candidate_id", candidate.id)
      if (queueRow?.id) {
        await supabaseAdmin
          .from("resume_parse_jobs")
          .update({ status: "processing", locked_by: "api_fallback", locked_at: nowIso(), updated_at: nowIso() })
          .eq("id", queueRow.id)
      }
      try {
        Sentry.captureMessage("resume parse fallback triggered", { level: "warning", tags: { parsing_job_id: id } })
        await runFallbackParsing(job, String(candidate.id))
        await supabaseAdmin
          .from("parsing_jobs")
          .update({ status: "completed", parsing_method: "api_fallback", completed_at: nowIso(), updated_at: nowIso() })
          .eq("id", id)
          .eq("candidate_id", candidate.id)
        if (queueRow?.id) {
          await supabaseAdmin
            .from("resume_parse_jobs")
            .update({ status: "succeeded", locked_by: "api_fallback", locked_at: nowIso(), updated_at: nowIso(), error: null })
            .eq("id", queueRow.id)
        }
      } catch (e: any) {
        const msg = String(e?.message || e)
        Sentry.captureException(e, { tags: { parsing_job_id: id, candidate_id: String(candidate.id) } })
        await supabaseAdmin
          .from("parsing_jobs")
          .update({ status: "failed", completed_at: nowIso(), updated_at: nowIso() })
          .eq("id", id)
          .eq("candidate_id", candidate.id)
        if (queueRow?.id) {
          await supabaseAdmin
            .from("resume_parse_jobs")
            .update({ status: "failed", locked_by: "api_fallback", locked_at: nowIso(), updated_at: nowIso(), error: msg })
            .eq("id", queueRow.id)
        }
      }
    }
    const { data: refreshed } = await supabaseAdmin
      .from("parsing_jobs")
      .select("*")
      .eq("id", id)
      .eq("candidate_id", candidate.id)
      .single()
    if (refreshed) return NextResponse.json({ parsingJob: refreshed })
  }
  return NextResponse.json({ parsingJob: job })
}
