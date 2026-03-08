"use client"

import { useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { ensureAttributionAccepted } from "@/lib/attribution"
import { Button } from "@/components/ui/Button"
import { Card, CardBody } from "@/components/ui/Card"
import { Spinner } from "@/components/ui/Spinner"

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3.1l5.7-5.7C34.9 6.1 29.7 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.4 19 12 24 12c3 0 5.8 1.1 7.9 3.1l5.7-5.7C34.9 6.1 29.7 4 24 4c-7.7 0-14.4 4.3-17.7 10.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.3l-6.3-5.2C29.3 36 26.8 37 24 37c-5.3 0-9.8-3.3-11.4-8l-6.6 5.1C9.3 40.1 16.1 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1 2.8-3 5.1-5.7 6.5l6.3 5.2C39.9 36.1 44 30.6 44 24c0-1.3-.1-2.5-.4-3.5z"/>
    </svg>
  )
}

export function AuthStep({
  jobId,
  returnTo: returnToProp,
  requireConsent = true,
  title,
  description,
  onError
}: {
  jobId: string
  returnTo?: string
  requireConsent?: boolean
  title?: string
  description?: string
  onError: (message: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [consent, setConsent] = useState(true)

  const returnTo = useMemo(() => returnToProp || `/jobs/${jobId}?apply=1`, [jobId, returnToProp])

  const signInGoogle = async () => {
    if (requireConsent && !consent) {
      onError("Please confirm to continue")
      return
    }
    setBusy(true)
    onError(null)
    ensureAttributionAccepted()
    const origin = window.location.origin
    const redirectTo = `${origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } })
    setBusy(false)
  }

  return (
    <Card>
      <CardBody className="pt-6">
        <div className="grid gap-4">
          <div>
            <div className="text-base font-semibold">{title || "Upload your CV to apply"}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {description || "Create your profile once for faster applications to logistics jobs."}
            </div>
          </div>

          {requireConsent ? (
            <label className="flex items-start gap-3 rounded-2xl border bg-accent p-4 text-sm">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked)
                  if (e.target.checked) onError(null)
                }}
                className="mt-1 h-4 w-4"
              />
              <div>
                <div className="font-medium">I agree to create a GatiHire profile</div>
                <div className="mt-1 text-muted-foreground">We’ll save your resume and preferences so you can apply in a few taps next time.</div>
              </div>
            </label>
          ) : null}

          <Button onClick={signInGoogle} disabled={busy || (requireConsent && !consent)} className="w-full h-12">
            {busy ? <Spinner /> : <GoogleMark />}
            Continue with Google
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
