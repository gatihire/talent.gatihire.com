import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getAuthedUser } from "@/lib/apiServerAuth"
import { cache } from "@/lib/cache"

export const runtime = "nodejs"

async function getCandidateId(user: { id: string; email: string }) {
  const { data: byAuth, error: authErr } = await supabaseAdmin
    .from("candidates")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  if (authErr) throw new Error("Failed to load candidate")
  if (byAuth?.id) return String(byAuth.id)

  const email = String(user.email || "").trim().toLowerCase()
  if (!email) return null

  const { data: byEmail, error: emailErr } = await supabaseAdmin
    .from("candidates")
    .select("id")
    .eq("email", email)
    .maybeSingle()
  if (emailErr) throw new Error("Failed to load candidate")
  return byEmail?.id ? String(byEmail.id) : null
}

export async function GET(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const cacheKey = `candidate:notifications:${user.id}`
  const cached = await cache.get(cacheKey)
  if (cached) return NextResponse.json(cached)

  const candidateId = await getCandidateId(user)
  if (!candidateId) {
    const payload = { notifications: [], unreadCount: 0 }
    await cache.set(cacheKey, payload, 15)
    return NextResponse.json(payload)
  }

  const { data, error } = await supabaseAdmin
    .from("candidate_notifications")
    .select("id,type,payload,is_read,created_at")
    .eq("candidate_id", candidateId)
    .in("type", ["welcome", "application_submitted", "application_status_changed", "new_job_match", "new_job_published"])
    .order("created_at", { ascending: false })
    .limit(30)
  if (error) return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 })

  const unreadCount = (data || []).reduce((acc: number, n: any) => (n?.is_read ? acc : acc + 1), 0)
  const payload = { notifications: data || [], unreadCount }
  await cache.set(cacheKey, payload, 15)
  return NextResponse.json(payload)
}

export async function POST(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const candidateId = await getCandidateId(user)
  if (!candidateId) return NextResponse.json({ success: true })

  const body = (await request.json().catch(() => null)) as any
  const action = String(body?.action || "")
  if (action !== "mark_read" && action !== "mark_all_read") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  }

  if (action === "mark_all_read") {
    const { error } = await supabaseAdmin
      .from("candidate_notifications")
      .update({ is_read: true })
      .eq("candidate_id", candidateId)
      .eq("is_read", false)
    if (error) return NextResponse.json({ error: "Failed to update" }, { status: 500 })
    await cache.del(`candidate:notifications:${user.id}`)
    return NextResponse.json({ success: true })
  }

  const id = String(body?.id || "").trim()
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

  const { error } = await supabaseAdmin
    .from("candidate_notifications")
    .update({ is_read: true })
    .eq("candidate_id", candidateId)
    .eq("id", id)
  if (error) return NextResponse.json({ error: "Failed to update" }, { status: 500 })
  await cache.del(`candidate:notifications:${user.id}`)
  return NextResponse.json({ success: true })
}
