import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { uploadFileToSupabase } from "@/lib/supabase-storage-utils"
import { getAuthedUser } from "@/lib/apiServerAuth"
import { parseResume } from "@/lib/resume-parser"

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
    const updates: any = {
      auth_user_id: user.id,
      file_name: file.name,
      file_url: fileUrl,
      file_size: file.size,
      file_type: file.type || "application/octet-stream",
      uploaded_at: nowIso(),
      updated_at: nowIso()
    }

    const { data: updatedCandidate, error: candErr } = await supabaseAdmin
      .from("candidates")
      .update(updates)
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
        status: "processing", // changed from pending
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

    stage = "parse_sync"
    let finalCandidate = updatedCandidate
    try {
      // Create a File object compatible with parseResume
      const fileBuffer = await file.arrayBuffer()
      const parseFile = {
        name: file.name,
        type: file.type || "application/octet-stream",
        arrayBuffer: async () => fileBuffer,
      } as any

      const parsed = await parseResume(parseFile)
      
      const candidateUpdate: any = {}
      
      function nonEmptyString(v: any) {
        if (typeof v !== "string") return null
        const t = v.trim()
        if (!t || t.toLowerCase() === "not specified" || t.toLowerCase() === "unknown") return null
        return t
      }
      
      function nonEmptyStringArray(v: any) {
        if (!Array.isArray(v)) return null
        const cleaned = v.filter(x => typeof x === "string").map(x => x.trim()).filter(x => x.length > 0 && x.toLowerCase() !== "unknown" && x.toLowerCase() !== "not specified")
        return cleaned.length ? cleaned : null
      }

      if (nonEmptyString(parsed.name)) candidateUpdate.name = nonEmptyString(parsed.name)
      if (nonEmptyString(parsed.phone)) candidateUpdate.phone = nonEmptyString(parsed.phone)
      if (nonEmptyString(parsed.currentRole)) candidateUpdate.current_role = nonEmptyString(parsed.currentRole)
      if (nonEmptyString(parsed.currentCompany)) candidateUpdate.current_company = nonEmptyString(parsed.currentCompany)
      if (nonEmptyString(parsed.location)) candidateUpdate.location = nonEmptyString(parsed.location)
      if (nonEmptyString(parsed.totalExperience)) candidateUpdate.total_experience = nonEmptyString(parsed.totalExperience)
      if (nonEmptyString(parsed.highestQualification)) candidateUpdate.highest_qualification = nonEmptyString(parsed.highestQualification)
      if (nonEmptyString(parsed.degree)) candidateUpdate.degree = nonEmptyString(parsed.degree)
      if (nonEmptyString(parsed.specialization)) candidateUpdate.specialization = nonEmptyString(parsed.specialization)
      if (nonEmptyString(parsed.university)) candidateUpdate.university = nonEmptyString(parsed.university)
      if (nonEmptyString(parsed.educationYear)) candidateUpdate.education_year = nonEmptyString(parsed.educationYear)
      if (nonEmptyString(parsed.educationPercentage)) candidateUpdate.education_percentage = nonEmptyString(parsed.educationPercentage)
      if (nonEmptyString(parsed.additionalQualifications)) candidateUpdate.additional_qualifications = nonEmptyString(parsed.additionalQualifications)
      if (nonEmptyString(parsed.summary)) candidateUpdate.summary = nonEmptyString(parsed.summary)
      if (nonEmptyString(parsed.resumeText)) candidateUpdate.resume_text = nonEmptyString(parsed.resumeText)

      if (nonEmptyStringArray(parsed.technicalSkills)) candidateUpdate.technical_skills = nonEmptyStringArray(parsed.technicalSkills)
      if (nonEmptyStringArray(parsed.softSkills)) candidateUpdate.soft_skills = nonEmptyStringArray(parsed.softSkills)
      if (nonEmptyStringArray(parsed.languagesKnown)) candidateUpdate.languages_known = nonEmptyStringArray(parsed.languagesKnown)
      if (nonEmptyStringArray(parsed.certifications)) candidateUpdate.certifications = nonEmptyStringArray(parsed.certifications)
      if (nonEmptyStringArray(parsed.previousCompanies)) candidateUpdate.previous_companies = nonEmptyStringArray(parsed.previousCompanies)
      if (nonEmptyStringArray(parsed.jobTitles)) candidateUpdate.job_titles = nonEmptyStringArray(parsed.jobTitles)
      if (nonEmptyStringArray(parsed.workDuration)) candidateUpdate.work_duration = nonEmptyStringArray(parsed.workDuration)
      if (nonEmptyStringArray(parsed.keyAchievements)) candidateUpdate.key_achievements = nonEmptyStringArray(parsed.keyAchievements)
      if (nonEmptyStringArray(parsed.projects)) candidateUpdate.projects = nonEmptyStringArray(parsed.projects)

      candidateUpdate.updated_at = nowIso()

      if (Object.keys(candidateUpdate).length > 1) {
        const { data: updated2 } = await supabaseAdmin
          .from("candidates")
          .update(candidateUpdate)
          .eq("id", candidateId)
          .select("*")
          .single()
        if (updated2) finalCandidate = updated2
      }
      
      const parsedWorkExperience = Array.isArray(parsed.workExperience) ? parsed.workExperience : []
      if (parsedWorkExperience.length) {
        await supabaseAdmin.from("work_experience").delete().eq("candidate_id", candidateId)
        const rows = parsedWorkExperience.map((it: any) => ({
          candidate_id: candidateId,
          company: nonEmptyString(it?.company) || "Not specified",
          role: nonEmptyString(it?.role) || "Not specified",
          duration: nonEmptyString(it?.duration) || "Not specified",
          location: nonEmptyString(it?.location),
          description: nonEmptyString(it?.description),
          responsibilities: Array.isArray(it?.responsibilities) ? it.responsibilities.map((x:any)=>String(x).trim()).filter(Boolean).join("\n") : nonEmptyString(it?.responsibilities),
          achievements: Array.isArray(it?.achievements) ? it.achievements.map((x:any)=>String(x).trim()).filter(Boolean).join("\n") : nonEmptyString(it?.achievements),
          technologies: nonEmptyStringArray(it?.technologies),
          created_at: nowIso(),
        })).filter(x => x.company !== "Not specified" || x.role !== "Not specified")
        if (rows.length) await supabaseAdmin.from("work_experience").insert(rows)
      }

      const parsedEducation = Array.isArray(parsed.education) ? parsed.education : []
      if (parsedEducation.length) {
        await supabaseAdmin.from("education").delete().eq("candidate_id", candidateId)
        const rows = parsedEducation.map((it: any) => ({
          candidate_id: candidateId,
          degree: nonEmptyString(it?.degree) || "Not specified",
          specialization: nonEmptyString(it?.specialization),
          institution: nonEmptyString(it?.institution) || nonEmptyString(it?.university) || "Not specified",
          year: nonEmptyString(it?.year) || nonEmptyString(it?.endYear) || nonEmptyString(it?.educationYear),
          percentage: nonEmptyString(it?.percentage),
          description: nonEmptyString(it?.description),
          created_at: nowIso(),
        })).filter(x => x.degree !== "Not specified" || x.institution !== "Not specified")
        if (rows.length) await supabaseAdmin.from("education").insert(rows)
      }

      await supabaseAdmin
        .from("parsing_jobs")
        .update({ status: "completed", completed_at: nowIso() })
        .eq("id", parsingJob.id)
        
      parsingJob.status = "completed"

    } catch (parseErr: any) {
      console.error("Synchronous parsing failed:", parseErr)
      await supabaseAdmin
        .from("parsing_jobs")
        .update({ status: "failed", error: String(parseErr.message || "") })
        .eq("id", parsingJob.id)
      parsingJob.status = "failed"
    }

    return NextResponse.json({ candidate: finalCandidate, parsingJob })
  } catch (e: any) {
    const message = typeof e?.message === "string" && e.message.trim() ? e.message.trim() : "Internal Server Error"
    console.error("/api/candidate/resume/parse error", { stage, message })
    return NextResponse.json({ error: message, stage }, { status: 500 })
  }
}
