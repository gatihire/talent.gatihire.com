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
  if (!body?.jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

  let candidateResult = await supabaseAdmin
    .from("candidates")
    .select("id,name,email,phone,current_role,total_experience,location,file_url")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  if (!candidateResult.data) {
    const email = String(user.email || "").trim().toLowerCase()
    if (email) {
      candidateResult = await supabaseAdmin
        .from("candidates")
        .select("id,name,email,phone,current_role,total_experience,location,file_url")
        .eq("email", email)
        .maybeSingle()
    }
  }

  const { data: candidate, error: cErr } = candidateResult
  if (cErr) return NextResponse.json({ error: "Failed to load candidate" }, { status: 500 })
  if (!candidate?.id) return NextResponse.json({ error: "Candidate profile not found" }, { status: 404 })

  // Persist the apply-form compensation details to the candidate so the admin
  // screening flow (Flow A / portal) can pre-seed them instead of asking on
  // WhatsApp. current_ctc/expected_ctc feed the WhatsApp + Bolna pre-seed,
  // current_salary/expected_salary drive the admin sidebar + client profile UI.
  const currentCtc = typeof body.currentCtc === "string" ? body.currentCtc.trim() : ""
  const expectedCtc = typeof body.expectedCtc === "string" ? body.expectedCtc.trim() : ""
  const noticePeriod = typeof body.noticePeriod === "string" ? body.noticePeriod.trim() : ""
  const reasonForSwitching = typeof body.reasonForSwitching === "string" ? body.reasonForSwitching.trim() : ""
  if (currentCtc || expectedCtc || noticePeriod || reasonForSwitching) {
    await supabaseAdmin
      .from("candidates")
      .update({
        ...(currentCtc ? { current_ctc: currentCtc, current_salary: currentCtc } : {}),
        ...(expectedCtc ? { expected_ctc: expectedCtc, expected_salary: expectedCtc } : {}),
        ...(noticePeriod ? { notice_period: noticePeriod } : {}),
        ...(reasonForSwitching ? { reason_for_switching: reasonForSwitching } : {}),
        updated_at: nowIso(),
      })
      .eq("id", candidate.id)
  }

  if (!candidate.file_url) return NextResponse.json({ error: "Resume required" }, { status: 400 })
  const email = String((candidate as any)?.email || "").trim()
  const phone = String((candidate as any)?.phone || "").trim()
  if (!candidate.name || !candidate.current_role || !candidate.total_experience || !candidate.location || !email || !phone) {
    return NextResponse.json({ error: "Complete required profile fields" }, { status: 400 })
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 })
  }

  const baseInsert: any = {
    job_id: body.jobId,
    candidate_id: candidate.id,
    status: "applied",
    candidate_notes: typeof body.coverLetter === "string" && body.coverLetter.trim() ? body.coverLetter.trim() : null,
    source: "board-app",
    applied_at: nowIso(),
    updated_at: nowIso()
  }

  let insertErr: any = null
  let insertedId: string | null = null
  {
    const { data: inserted, error } = await supabaseAdmin.from("applications").insert(baseInsert).select("id").maybeSingle()
    insertErr = error
    insertedId = (inserted as any)?.id || null
  }

  if (insertErr) {
    if (insertErr.code === "23505") {
      const now = nowIso()
      const { data: existing } = await supabaseAdmin
        .from("applications")
        .select("id, status, source, applied_at")
        .eq("job_id", body.jobId)
        .eq("candidate_id", candidate.id)
        .maybeSingle()

      if (existing?.id) {
        const nextSource =
          existing.source === "database" ? "database > board-app" : existing.source || "board-app"
        await supabaseAdmin
          .from("applications")
          .update({
            source: nextSource,
            applied_at: existing.applied_at || now,
            updated_at: now,
          })
          .eq("id", existing.id)
      }

      if (typeof body.inviteToken === "string" && body.inviteToken) {
        await supabaseAdmin
          .from("job_invites")
          .update({ status: "applied", applied_at: now, responded_at: now, updated_at: now, candidate_id: candidate.id })
          .eq("token", body.inviteToken)
          .eq("job_id", body.jobId)
      }

      await cache.del(`candidate:applications:${user.id}:all`)
      await cache.del(`candidate:applications:${user.id}:${body.jobId}`)
      await cache.del(`candidate:notifications:${user.id}`)
      return NextResponse.json({ success: true, existed: true, applicationId: existing?.id || null })
    }

    const msg = String(insertErr.message || "")
    const hintsColumnMissing = insertErr.code === "PGRST204" || msg.toLowerCase().includes("column")
    if (hintsColumnMissing) {
      if (msg.toLowerCase().includes("source")) {
        const retryPayload = { ...baseInsert }
        delete retryPayload.source
        const { error: retryErr } = await supabaseAdmin.from("applications").insert(retryPayload)
        if (!retryErr) insertErr = null
        else insertErr = retryErr
      }
      if (insertErr && msg.toLowerCase().includes("updated_at")) {
        const retryPayload = { ...baseInsert }
        delete retryPayload.source
        delete retryPayload.updated_at
        const { error: retryErr } = await supabaseAdmin.from("applications").insert(retryPayload)
        if (!retryErr) insertErr = null
        else insertErr = retryErr
      }
    }
  }

  if (insertErr) {
    console.error("Application submit failed:", insertErr)
    return NextResponse.json({ error: insertErr.message || "Failed to submit application" }, { status: 500 })
  }

  if (typeof body.inviteToken === "string" && body.inviteToken) {
    const now = nowIso()
    const { error: inviteErr } = await supabaseAdmin
      .from("job_invites")
      .update({ status: "applied", applied_at: now, responded_at: now, updated_at: now, candidate_id: candidate.id })
      .eq("token", body.inviteToken)
      .eq("job_id", body.jobId)
    if (inviteErr) console.warn("Failed to update invite status:", inviteErr)
  }

  ;(async () => {
    try {
      const { data: job } = await supabaseAdmin.from("jobs").select("id,title,client_name").eq("id", body.jobId).maybeSingle()
      await supabaseAdmin.from("candidate_notifications").insert({
        candidate_id: candidate.id,
        type: "application_submitted",
        payload: { jobId: body.jobId, title: job?.title || null, company: job?.client_name || null, applicationId: insertedId }
      })
    } catch {
      return
    }
  })()

  await cache.del(`candidate:applications:${user.id}:all`)
  await cache.del(`candidate:applications:${user.id}:${body.jobId}`)
  await cache.del(`candidate:notifications:${user.id}`)
  return NextResponse.json({ success: true, applicationId: insertedId })
}
