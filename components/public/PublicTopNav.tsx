"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/Button"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { AuthModal } from "@/components/auth/AuthModal"
import { BRAND_LOGO_URL, BRAND_NAME } from "@/lib/branding"
import { useSupabaseSession } from "@/lib/useSupabaseSession"

export function PublicTopNav({ minimal }: { minimal?: boolean } = {}) {
  const { session } = useSupabaseSession()
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<"login" | "signup">("login")

  const openAuth = (mode: "login" | "signup") => {
    setAuthMode(mode)
    setAuthOpen(true)
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/jobs" className="flex items-center gap-2">
          <div className="h-9 w-28 overflow-hidden">
            <img 
              src={BRAND_LOGO_URL} 
              alt={BRAND_NAME} 
              className="h-full w-full object-contain dark:invert transition-all duration-300" 
            />
          </div>
        </Link>

        {minimal ? null : (
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link href="/jobs" className="hover:text-foreground">
              Jobs
            </Link>
            <Link href="/contact-sales" className="hover:text-foreground">
              Company
            </Link>
          </nav>
        )}

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {!session ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => openAuth("login")}>
                Log in
              </Button>
              {minimal ? null : (
                <Link href="/contact-sales" className="hidden sm:block">
                  <Button variant="secondary" size="sm">
                    Book Demo
                  </Button>
                </Link>
              )}
              <Button size="sm" onClick={() => openAuth("signup")}>
                Talent Sign Up
              </Button>
            </>
          ) : (
            <Link href="/dashboard">
              <Button size="sm">Dashboard</Button>
            </Link>
          )}
        </div>
      </div>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} defaultMode={authMode} />
    </header>
  )
}
