import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getAuthedUser } from "@/lib/apiServerAuth"

export const runtime = "nodejs"

function nowIso() {
  return new Date().toISOString()
}

export async function GET(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from("candidates")
    .select("looking_for_work,open_job_types,available_start_time,available_end_time,work_timezone,preferred_location,work_availability_updated_at,current_salary,expected_salary,notice_period,available_start_date,availability_notes")
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
    .maybeSingle()

  if (error) return NextResponse.json({ error: "Failed to load" }, { status: 500 })
  return NextResponse.json({ availability: data || null })
}

export async function PUT(request: NextRequest) {
  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as any
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

  const patch: Record<string, unknown> = {
    looking_for_work: Boolean(body.looking_for_work),
    open_job_types: Array.isArray(body.open_job_types) ? body.open_job_types.filter((x: any) => typeof x === "string") : [],
    available_start_time: typeof body.available_start_time === "string" ? body.available_start_time : null,
    available_end_time: typeof body.available_end_time === "string" ? body.available_end_time : null,
    work_timezone: typeof body.work_timezone === "string" ? body.work_timezone : null,
    preferred_location: typeof body.preferred_location === "string" ? body.preferred_location : null,
    current_salary: typeof body.current_salary === "string" ? body.current_salary : null,
    expected_salary: typeof body.expected_salary === "string" ? body.expected_salary : null,
    notice_period: typeof body.notice_period === "string" ? body.notice_period : null,
    available_start_date: typeof body.available_start_date === "string" ? body.available_start_date : null,
    availability_notes: typeof body.availability_notes === "string" ? body.availability_notes : null,
    work_availability_updated_at: nowIso(),
    updated_at: nowIso()
  }

  const { data: existing, error: findErr } = await supabaseAdmin
    .from("candidates")
    .select("id")
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
    .maybeSingle()
  if (findErr) return NextResponse.json({ error: "Failed to load candidate" }, { status: 500 })

  if (existing?.id) {
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("candidates")
      .update(patch)
      .eq("id", existing.id)
      .select("looking_for_work,open_job_types,available_start_time,available_end_time,work_timezone,preferred_location,work_availability_updated_at,current_salary,expected_salary,notice_period,available_start_date,availability_notes")
      .single()
    if (updateErr) return NextResponse.json({ error: "Failed to update" }, { status: 500 })
    return NextResponse.json({ availability: updated })
  }

  const baseName = user.email.split("@")[0]
  const { data: created, error: createErr } = await supabaseAdmin
    .from("candidates")
    .insert({
      auth_user_id: user.id,
      email: user.email,
      name: baseName,
      current_role: "Candidate",
      total_experience: "0",
      location: "Unknown",
      status: "new",
      uploaded_at: nowIso(),
      updated_at: nowIso(),
      ...patch
    })
    .select("looking_for_work,open_job_types,available_start_time,available_end_time,work_timezone,preferred_location,work_availability_updated_at,current_salary,expected_salary,notice_period,available_start_date,availability_notes")
    .single()

  if (createErr) return NextResponse.json({ error: "Failed to create candidate" }, { status: 500 })
  return NextResponse.json({ availability: created })
}
