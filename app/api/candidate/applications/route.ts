import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getAuthedUser } from "@/lib/apiServerAuth"
import { cache } from "@/lib/cache"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get("jobId")
  const cacheKey = `candidate:applications:${user.id}:${jobId || "all"}`
  const cached = await cache.get(cacheKey)
  if (cached) return NextResponse.json(cached)

  const { data: byAuth, error: authErr } = await supabaseAdmin
    .from("candidates")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  if (authErr) return NextResponse.json({ error: "Failed to load candidate" }, { status: 500 })
  let candidateId = byAuth?.id ? String(byAuth.id) : ""
  if (!candidateId) {
    const email = String(user.email || "").trim().toLowerCase()
    if (email) {
      const { data: byEmail, error: emailErr } = await supabaseAdmin
        .from("candidates")
        .select("id")
        .eq("email", email)
        .maybeSingle()
      if (emailErr) return NextResponse.json({ error: "Failed to load candidate" }, { status: 500 })
      candidateId = byEmail?.id ? String(byEmail.id) : ""
    }
  }
  if (!candidateId) {
    const payload = { applications: [] }
    await cache.set(cacheKey, payload, 15)
    return NextResponse.json(payload)
  }

  let query = supabaseAdmin
    .from("applications")
    .select("id, job_id, status, applied_at, updated_at, source, jobs(id,title,client_name,location)")
    .eq("candidate_id", candidateId)

  if (jobId) query = query.eq("job_id", jobId)

  const limit = jobId ? 1 : 60
  const { data: applications, error: aErr } = await query.order("applied_at", { ascending: false }).limit(limit)

  if (aErr) return NextResponse.json({ error: "Failed to load applications" }, { status: 500 })
  const payload = { applications: applications || [] }
  await cache.set(cacheKey, payload, 15)
  return NextResponse.json(payload)
}
