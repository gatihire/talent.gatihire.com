import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getAuthedUser } from "@/lib/apiServerAuth"
import { RESUME_BUCKET } from "@/lib/constants/storage"

export const runtime = "nodejs"

async function resolveCandidateId(authUserId: string, email: string) {
  const { data, error } = await supabaseAdmin
    .from("candidates")
    .select("id,auth_user_id,email")
    .or(`auth_user_id.eq.${authUserId},email.eq.${email}`)
    .maybeSingle()

  if (error) throw new Error("Failed to load candidate")
  return data?.id ? String(data.id) : null
}

export async function GET(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const candidateId = await resolveCandidateId(user.id, user.email)
    if (!candidateId) return NextResponse.json({ error: "Candidate not found" }, { status: 404 })

    const { data: fileRow, error: fileErr } = await supabaseAdmin
      .from("file_storage")
      .select("original_path,created_at")
      .eq("candidate_id", candidateId)
      .eq("storage_provider", "supabase")
      .not("original_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fileErr) throw new Error("Failed to load resume")
    const originalPath = typeof (fileRow as any)?.original_path === "string" ? String((fileRow as any).original_path) : ""
    if (!originalPath) {
      const { data: candidate, error: candidateErr } = await supabaseAdmin
        .from("candidates")
        .select("file_url")
        .eq("id", candidateId)
        .maybeSingle()
      if (candidateErr) throw new Error("Failed to load resume")
      const fallbackUrl = typeof candidate?.file_url === "string" ? String(candidate.file_url) : ""
      if (!fallbackUrl) return NextResponse.json({ error: "Resume not found" }, { status: 404 })
      return NextResponse.json({ signedUrl: fallbackUrl, expiresIn: 0 })
    }

    const expiresIn = Math.min(3600, Math.max(60, Number(request.nextUrl.searchParams.get("expiresIn") || 600)))
    const { data, error } = await supabaseAdmin.storage.from(RESUME_BUCKET).createSignedUrl(originalPath, expiresIn)
    if (error || !data?.signedUrl) throw new Error("Failed to create signed URL")

    return NextResponse.json({ signedUrl: data.signedUrl, expiresIn })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal Server Error" }, { status: 500 })
  }
}
