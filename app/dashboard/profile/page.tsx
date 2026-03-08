"use client"

import { useEffect, useState } from "react"
import type { Candidate } from "@/lib/types"
import { useSupabaseSession } from "@/lib/useSupabaseSession"
import { bearerHeaders } from "@/lib/http"
import { ProfileBraintrust } from "@/components/dashboard/ProfileBraintrust"
import { Spinner } from "@/components/ui/Spinner"

export default function ProfilePage() {
  const { session, loading } = useSupabaseSession()
  const accessToken = session?.access_token
  const googleAvatarUrl =
    (session?.user?.user_metadata as any)?.avatar_url ||
    (session?.user?.user_metadata as any)?.picture ||
    (session?.user?.user_metadata as any)?.photoURL ||
    null

  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [workItems, setWorkItems] = useState<any[]>([])
  const [educationItems, setEducationItems] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    let active = true
    setBusy(true)
    setError(null)
    fetch("/api/candidate/profile?details=1", { headers: bearerHeaders(accessToken) })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        if (data?.error) throw new Error(data.error)
        setCandidate(data.candidate)
        setWorkItems(data.workItems || [])
        setEducationItems(data.educationItems || [])
      })
      .catch((e: any) => {
        if (!active) return
        setError(e.message || "Failed to load")
      })
      .finally(() => {
        if (!active) return
        setBusy(false)
      })

    return () => {
      active = false
    }
  }, [accessToken])

  if (!accessToken) return <div className="rounded-3xl border bg-card p-8">{loading ? <Spinner /> : "Unauthorized"}</div>

  if (busy) return <div className="rounded-3xl border bg-card p-8"><Spinner /></div>
  if (error) return <div className="rounded-3xl border bg-card p-8 text-sm">{error}</div>
  if (!candidate) return <div className="rounded-3xl border bg-card p-8 text-sm">Profile not found.</div>

  return (
    <ProfileBraintrust
      accessToken={accessToken}
      candidate={candidate}
      onCandidateUpdated={(c) => setCandidate(c as any)}
      googleAvatarUrl={typeof googleAvatarUrl === "string" ? googleAvatarUrl : undefined}
      initialWorkItems={workItems}
      initialEducationItems={educationItems}
    />
  )
}
