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

  const response = NextResponse.redirect(new URL(returnTo, request.url))
  const supabase = createSupabaseMiddlewareClient(request, response)
  await supabase.auth.exchangeCodeForSession(code)
  return response
}
