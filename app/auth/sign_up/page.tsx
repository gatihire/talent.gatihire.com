import { Suspense } from "react"
import { AuthShell } from "@/components/auth/AuthShell"
import { SignupForm } from "@/components/auth/SignupForm"

export const metadata = {
  title: "Create profile",
}

export default function SignUpPage() {
  return (
    <AuthShell title="Create profile" subtitle="Join the GatiHire talent network to apply for logistics jobs.">
      <Suspense fallback={<div className="h-[360px] rounded-2xl border bg-card" />}>
        <SignupForm />
      </Suspense>
    </AuthShell>
  )
}
