"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ApplyStepper } from "@/components/ApplyStepper"
import { ThemeToggle } from "@/components/theme/ThemeToggle"

export const runtime = "nodejs"

export default function OnboardingPage() {
  const sp = useSearchParams()
  const returnTo = (sp.get("returnTo") || "/dashboard/jobs").trim() || "/dashboard/jobs"

  return (
    <div className="min-h-screen bg-app">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/jobs" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-primary/10" />
            <div className="text-sm font-semibold">GatiHire</div>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="rounded-3xl border bg-card p-8">
          <div className="text-2xl font-semibold">Create your profile</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Upload your resume, review details, then start applying in one tap.
          </div>
          <div className="mt-6">
            <ApplyStepper mode="profile" returnTo={returnTo} authRequireConsent={false} />
          </div>
        </div>
      </main>
    </div>
  )
}

