import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getAuthedUser } from "@/lib/apiServerAuth"

export const runtime = "nodejs"

function nowIso() {
  return new Date().toISOString()
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const adminKey = process.env.BOARD_APP_ADMIN_KEY || ""
  const provided = request.headers.get("x-board-admin-key") || ""
  if (!adminKey || provided !== adminKey) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { user } = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = (await request.json().catch(() => null)) as any
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: nowIso() }
  const allowed = ["client_id", "client_name", "salary_type", "salary_min", "salary_max", "skills_must_have", "apply_type", "external_apply_url"]
  for (const k of allowed) {
    if (k in body) patch[k] = body[k]
  }

  const { data, error } = await supabaseAdmin.from("jobs").update(patch).eq("id", id).select("*").single()
  if (error) return NextResponse.json({ error: "Failed to update job" }, { status: 500 })
  return NextResponse.json({ job: data })
}
