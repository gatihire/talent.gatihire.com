 "use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function AuthCallbackPage() {
  const router = useRouter()
  const sp = useSearchParams()
  useEffect(() => {
    ;(async () => {
      // Decide destination: first-time users go to onboarding
      let dest = sp.get("returnTo") || "/dashboard/jobs"
      if (!dest.startsWith("/")) dest = "/dashboard/jobs"
      try {
        // Ensure session cookies applied
        await supabase.auth.getSession()
        const res = await fetch("/api/candidate/profile")
        if (res.ok) {
          const data = await res.json().catch(() => null)
          const c = data?.candidate || null
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
      router.replace(dest)
    })()
  }, [router, sp])
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "60vh", color: "#444" }}>
      <div>Signing you in…</div>
    </div>
  )
}
