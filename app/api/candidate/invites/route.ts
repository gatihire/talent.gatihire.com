import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getAuthedUser } from "@/lib/apiServerAuth"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: candidate, error: cErr } = await supabaseAdmin
    .from("candidates")
    .select("id")
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
    .maybeSingle()

  if (cErr) return NextResponse.json({ error: "Failed to load candidate" }, { status: 500 })
  if (!candidate?.id) return NextResponse.json({ invites: [] })

  const candidateId = candidate?.id as string | undefined

  const query = supabaseAdmin
    .from("job_invites")
    .select("id, job_id, email, token, status, sent_at, opened_at, responded_at, applied_at, rejected_at, created_at, jobs(id,title,client_name,location,industry,sub_category,employment_type)")
    .order("created_at", { ascending: false })

  const { data: invites, error: iErr } = candidateId
    ? await query.or(`candidate_id.eq.${candidateId},email.eq.${user.email}`)
    : await query.eq("email", user.email)

  if (iErr) {
    console.error("Failed to load invites:", iErr)
    return NextResponse.json({ error: iErr.message || "Failed to load invites" }, { status: 500 })
  }
  return NextResponse.json({ invites: invites || [] })
}

export async function POST(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as any
  const inviteId = typeof body?.inviteId === "string" ? body.inviteId : null
  const action = typeof body?.action === "string" ? body.action : null
  if (!inviteId || !action) return NextResponse.json({ error: "Missing inviteId/action" }, { status: 400 })

  const { data: candidate } = await supabaseAdmin
    .from("candidates")
    .select("id")
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
    .maybeSingle()

  const candidateId = candidate?.id as string | undefined

  const { data: invite } = await supabaseAdmin
    .from("job_invites")
    .select("id,email,candidate_id,status")
    .eq("id", inviteId)
    .maybeSingle()

  if (!invite?.id) return NextResponse.json({ error: "Invite not found" }, { status: 404 })
  const allowed = invite.email === user.email || (candidateId && invite.candidate_id === candidateId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const now = new Date().toISOString()
  if (action === "reject") {
    const { error } = await supabaseAdmin
      .from("job_invites")
      .update({ status: "rejected", rejected_at: now, responded_at: now, updated_at: now })
      .eq("id", inviteId)
    if (error) return NextResponse.json({ error: "Failed to reject" }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 })
}
