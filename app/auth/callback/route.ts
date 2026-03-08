import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createSupabaseMiddlewareClient } from "@/lib/supabaseSsr"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const redirectTo = request.nextUrl.clone()
  const code = redirectTo.searchParams.get("code")
  const returnTo = redirectTo.searchParams.get("returnTo") || "/dashboard/jobs"

  if (!code) {
    redirectTo.pathname = "/auth/login"
    redirectTo.search = `returnTo=${encodeURIComponent(returnTo)}`
    return NextResponse.redirect(redirectTo)
  }

  // Exchange the code for a session
  // Then decide destination: first-time or incomplete profiles go to onboarding
  let dest = returnTo.startsWith("/") ? returnTo : "/dashboard/jobs"
  const response = NextResponse.next()
  const supabase = createSupabaseMiddlewareClient(request, response)
  await supabase.auth.exchangeCodeForSession(code)

  try {
    const { data: userRes } = await supabase.auth.getUser()
    const userId = userRes?.user?.id || ""
    if (userId) {
      const { data: c } = await supabase
        .from("candidates")
        .select("id,file_url,total_experience,name,status")
        .eq("auth_user_id", userId)
        .maybeSingle()
      const isNew =
        !c ||
        !c.file_url ||
        !c.total_experience ||
        !c.name ||
        String(c.status || "").trim().toLowerCase() === "new"
      if (isNew) dest = "/onboarding"
    }
  } catch {
  }

  return NextResponse.redirect(new URL(dest, request.url))
}
