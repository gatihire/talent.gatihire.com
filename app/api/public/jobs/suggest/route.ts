import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { MIGRATION_ALL_SUGGESTIONS, getSuggestionMatches } from "@/lib/search-suggestions"

export const runtime = "nodejs"

function normalizeText(v: unknown) {
  return String(v || "").trim()
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const q = normalizeText(sp.get("text") || sp.get("q") || "")
  const limit = Math.min(Math.max(Number(sp.get("limit") || 8) || 8, 4), 12)

  const t = q.replace(/,/g, " ").trim()
  if (t.length < 2) return NextResponse.json({ items: [] as string[] })

  const like = `%${t}%`

  const { data, error } = await supabaseAdmin
    .from("jobs")
    .select("title,client_name,industry,department_category,role_category,sub_category")
    .eq("status", "open")
    .or(
      [
        `title.ilike.${like}`,
        `client_name.ilike.${like}`,
        `industry.ilike.${like}`,
        `department_category.ilike.${like}`,
        `role_category.ilike.${like}`,
        `sub_category.ilike.${like}`
      ].join(",")
    )
    .order("created_at", { ascending: false })
    .limit(40)

  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: unknown) => {
    const v = typeof raw === "string" ? raw.trim() : ""
    if (!v) return
    const key = v.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(v)
  }

  if (!error) {
    for (const row of (data || []) as any[]) {
      push(row.title)
      push(row.client_name)
      push(row.department_category)
      push(row.role_category)
      push(row.sub_category)
      if (out.length >= limit) break
    }
  }

  if (out.length < limit) {
    const fallbacks = getSuggestionMatches(t, MIGRATION_ALL_SUGGESTIONS, 24)
    for (const s of fallbacks) {
      push(s)
      if (out.length >= limit) break
    }
  }
  return NextResponse.json({ items: out.slice(0, limit) })
}
