import "./globals.css"
import type { ReactNode } from "react"
import type { Metadata } from "next"
import * as Sentry from "@sentry/nextjs"
import CookieConsent from "../components/CookieConsent"
import { ThemeProvider } from "@/components/theme/ThemeProvider"
import { ThemeScript } from "@/components/theme/ThemeScript"

export function generateMetadata(): Metadata {
  return {
    title: {
      default: "GatiHire",
      template: "%s | GatiHire",
    },
    description: "Premium Logistics Talent Network",
    other: {
      ...Sentry.getTraceData(),
    },
  }
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-background text-foreground">
        <ThemeProvider>
          {children}
          <CookieConsent />
        </ThemeProvider>
      </body>
    </html>
  )
}
