import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { RESUME_PARSE_MODELS } from "@/lib/resume-parser"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getAuthedUser } from "@/lib/apiServerAuth"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: candidate, error } = await supabaseAdmin
    .from("candidates")
    .select("id,name,email,current_role,current_company,desired_role,preferred_roles,preferred_location,technical_skills,summary,specialization")
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
    .maybeSingle()

  if (error) return NextResponse.json({ error: "Failed to load candidate" }, { status: 500 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ suggested_roles: [] as string[] })
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const modelName = process.env.GEMINI_CLASSIFIER_MODEL || process.env.GEMINI_MODEL || RESUME_PARSE_MODELS[0]
    const model = genAI.getGenerativeModel({ model: modelName })

    const profileText = [
      candidate?.name ? `Name: ${candidate.name}` : "",
      candidate?.current_role ? `Current role: ${candidate.current_role}` : "",
      candidate?.current_company ? `Current company: ${candidate.current_company}` : "",
      candidate?.desired_role ? `Desired role: ${candidate.desired_role}` : "",
      candidate?.preferred_location ? `Preferred location: ${candidate.preferred_location}` : "",
      candidate?.specialization ? `Specialization: ${candidate.specialization}` : "",
      Array.isArray(candidate?.technical_skills) && candidate.technical_skills.length
        ? `Skills: ${(candidate.technical_skills as string[]).slice(0, 30).join(", ")}`
        : "",
      candidate?.summary ? `Summary: ${candidate.summary}` : ""
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 6500)

    const prompt = `You are helping a logistics/transportation/supply-chain job platform.

Suggest role titles that match the candidate profile for logistics/transport roles.
Return ONLY valid JSON with key:
- suggested_roles: array of 8-16 role titles (strings)

Rules:
- Keep roles short (2-5 words)
- Prefer Indian logistics job titles (dispatch, fleet, warehouse, transport, supply chain, operations)
- Include a mix of junior and mid-level titles if possible

Candidate profile:
${profileText}`

    const result: any = await model.generateContent(prompt)
    const content = result.response.text()
    const match = content.match(/\{[\s\S]*\}/)
    const parsed = match ? JSON.parse(match[0]) : null
    const roles = Array.isArray(parsed?.suggested_roles)
      ? (parsed.suggested_roles as unknown[]).filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : []

    const suggested_roles = Array.from(new Set(roles)).slice(0, 24)
    return NextResponse.json({ suggested_roles })
  } catch (e: any) {
    return NextResponse.json({ suggested_roles: [] as string[] })
  }
}
