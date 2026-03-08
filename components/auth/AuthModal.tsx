"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Modal } from "@/components/ui/Modal"
import { Button } from "@/components/ui/Button"
import { supabase } from "@/lib/supabase"
import { Spinner } from "@/components/ui/Spinner"
import { FileUp, Sparkles, UserRoundCheck } from "lucide-react"
import { BRAND_NAME } from "@/lib/branding"

type Mode = "login" | "signup"

export function AuthModal({ open, onClose, defaultMode }: { open: boolean; onClose: () => void; defaultMode: Mode }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const returnTo = useMemo(() => {
    const explicit = sp.get("returnTo")
    if (explicit) return explicit
    const next = new URLSearchParams(sp.toString())
    next.delete("login")
    next.delete("createProfile")
    const qs = next.toString()
    return `${pathname}${qs ? `?${qs}` : ""}`
  }, [pathname, sp])

  const [mode, setMode] = useState<Mode>(defaultMode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMode(defaultMode)
  }, [defaultMode, open])

  const close = () => {
    const next = new URLSearchParams(sp.toString())
    next.delete("login")
    next.delete("createProfile")
    const qs = next.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false })
    onClose()
  }

  const GoogleLogo = (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.2 1.54 7.62 2.84l5.18-5.18C33.67 4.19 29.33 2 24 2 14.64 2 6.54 7.39 2.69 15.2l6.73 5.22C11.33 14.11 17.16 9.5 24 9.5Z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.54-.14-3.02-.4-4.45H24v8.43h12.63c-.54 2.9-2.18 5.35-4.64 7l7.1 5.5C43.59 36.77 46.5 31.16 46.5 24.5Z"
      />
      <path
        fill="#FBBC05"
        d="M9.42 28.42c-.48-1.42-.76-2.93-.76-4.42 0-1.5.28-3 .76-4.42l-6.73-5.22C1.15 17.09.5 20.49.5 24c0 3.51.65 6.91 2.19 9.64l6.73-5.22Z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.33 0 9.81-1.76 13.08-4.79l-7.1-5.5c-1.96 1.32-4.46 2.1-5.98 2.1-6.84 0-12.67-4.61-14.58-10.92l-6.73 5.22C6.54 40.61 14.64 46 24 46Z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  )

  const continueWithGoogle = async () => {
    setBusy(true)
    setError(null)
    try {
      const origin = window.location.origin
      const redirectTo = `${origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`
      const { error: err } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } })
      if (err) {
        setError(err.message)
        setBusy(false)
      }
    } catch (e: any) {
      setError(String(e?.message || "Failed to start Google sign-in"))
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title={mode === "login" ? "Welcome back" : "Create your profile"} size="md">
      <div className="p-1">
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <p className="text-sm text-zinc-500">
              {mode === "login" 
                ? "Sign in to manage your applications and track your progress." 
                : "Join the GatiHire talent network and apply to logistics jobs in one tap."}
            </p>
          </div>

          {error && <div className="p-3 text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl">{error}</div>}

          <div className="space-y-4">
            <Button
              variant="secondary"
              onClick={continueWithGoogle}
              disabled={busy}
              className="h-12 w-full rounded-xl border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 flex items-center justify-center gap-3 font-medium transition-all shadow-sm"
            >
              {busy ? <Spinner /> : GoogleLogo}
              Continue with Google
            </Button>
          </div>

          <div className="pt-4 border-t border-zinc-50 text-center">
            {mode === "login" ? (
              <button type="button" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors" onClick={() => setMode("signup")}>
                New to GatiHire? <span className="text-blue-600 font-medium hover:underline">Create profile</span>
              </button>
            ) : (
              <button type="button" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors" onClick={() => setMode("login")}>
                Already have a profile? <span className="text-blue-600 font-medium hover:underline">Sign in</span>
              </button>
            )}
          </div>
          
          <p className="text-[10px] text-zinc-400 text-center leading-relaxed">
            By continuing, you agree to our <a href="#" className="underline">Terms</a> and <a href="#" className="underline">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </Modal>
  )
}
