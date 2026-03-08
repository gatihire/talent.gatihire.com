import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getAuthedUser } from "@/lib/apiServerAuth"
import { cache } from "@/lib/cache"

export const runtime = "nodejs"

function nowIso() {
  return new Date().toISOString()
}

export async function POST(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as any
  const jobId = typeof body?.jobId === "string" ? body.jobId : ""
  const redirectUrl = typeof body?.redirectUrl === "string" ? body.redirectUrl.trim() : ""

  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })
  if (!redirectUrl) return NextResponse.json({ error: "Missing redirectUrl" }, { status: 400 })

  let candidateResult = await supabaseAdmin
    .from("candidates")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  if (!candidateResult.data) {
    const email = String(user.email || "").trim().toLowerCase()
    if (email) {
      candidateResult = await supabaseAdmin
        .from("candidates")
        .select("id")
        .eq("email", email)
        .maybeSingle()
    }
  }
  const candidate = candidateResult.data

  const ua = request.headers.get("user-agent")
  const referrer = typeof body?.referrer === "string" ? body.referrer : null

  const { error } = await supabaseAdmin.from("external_apply_events").insert({
    auth_user_id: user.id,
    candidate_id: candidate?.id || null,
    job_id: jobId,
    redirect_url: redirectUrl,
    user_agent: ua,
    referrer,
    created_at: nowIso()
  })

  if (error) return NextResponse.json({ error: "Failed to record external apply" }, { status: 500 })
  await cache.del(`candidate:applications:${user.id}:all`)
  await cache.del(`candidate:applications:${user.id}:${jobId}`)
  return NextResponse.json({ success: true })
}
