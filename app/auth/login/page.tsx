import { Suspense } from "react"
import { AuthShell } from "@/components/auth/AuthShell"
import { LoginForm } from "@/components/auth/LoginForm"

export const metadata = {
  title: "Log in",
}

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your GatiHire account to manage your applications.">
      <Suspense fallback={<div className="h-[320px] rounded-2xl border bg-card" />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  )
}
