"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useSearchParams } from "next/navigation"
import type { Candidate, ParsingJob } from "@/lib/types"
import { useSupabaseSession } from "@/lib/useSupabaseSession"
import { bearerHeaders } from "@/lib/http"
import { sanitizeReturnTo } from "@/lib/returnTo"
import { ResumeStep } from "@/components/apply/ResumeStep"
import { ProfileStep } from "@/components/apply/ProfileStep"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Spinner } from "@/components/ui/Spinner"
import { IndustryGateStep, type LogisticsConnected } from "@/components/onboarding/IndustryGateStep"
import { SpecializationStep } from "@/components/onboarding/SpecializationStep"

type Step = "gate" | "specialization" | "resume" | "profile"

const DOMAINS = [
  { id: "cargo", label: "Movement of Goods (Cargo)" },
  { id: "passenger", label: "Movement of People (Passenger mobility)" }
] as const

const MODES = [
  { id: "road", label: "Road" },
  { id: "rail", label: "Rail" },
  { id: "air", label: "Air" },
  { id: "water", label: "Water" },
  { id: "pipeline", label: "Pipeline" },
  { id: "multimodal", label: "Multimodal" },
  { id: "warehousing", label: "Warehousing" }
] as const

const MODE_CATEGORIES: Record<string, Array<{ id: string; label: string }>> = {
  road: [
    { id: "fleet_ops", label: "Fleet Operations" },
    { id: "last_mile", label: "Last-mile Delivery" },
    { id: "maintenance", label: "Fleet Management & Maintenance" },
    { id: "brokerage", label: "Freight Brokerage & Aggregation" },
    { id: "compliance", label: "Compliance & Documentation" }
  ],
  rail: [
    { id: "terminal_ops", label: "Rail Cargo Operations" },
    { id: "pft", label: "Private Freight Terminals" },
    { id: "planning", label: "Rail Logistics Planning" }
  ],
  air: [
    { id: "cargo_ops", label: "Airport Cargo Operations" },
    { id: "cold_chain", label: "Cold Chain / Pharma" },
    { id: "documentation", label: "Documentation & Customs" }
  ],
  water: [
    { id: "port_ops", label: "Port & Terminal Operations" },
    { id: "shipping", label: "Shipping Line Operations" },
    { id: "customs", label: "Customs & Port Compliance" }
  ],
  pipeline: [
    { id: "pipeline_ops", label: "Pipeline Operations" },
    { id: "integrity", label: "Integrity / Monitoring" }
  ],
  multimodal: [
    { id: "planning", label: "Multimodal Planning" },
    { id: "terminal", label: "Intermodal Terminals" }
  ],
  warehousing: [
    { id: "inbound", label: "Inbound" },
    { id: "inventory", label: "Storage & Inventory" },
    { id: "outbound", label: "Outbound" },
    { id: "mhe", label: "Material Handling Equipment" },
    { id: "cold_storage", label: "Cold Storage / Cold Chain" }
  ]
}

function upsertTaggedPrefix(tags: string[] | null | undefined, prefix: string, values: string[]) {
  const existing = Array.isArray(tags) ? tags.filter((t) => typeof t === "string") : []
  const kept = existing.filter((t) => !t.startsWith(prefix))
  return Array.from(new Set([...kept, ...values.map((v) => `${prefix}${v}`)])).slice(0, 60)
}

function readTaggedPrefix(tags: string[] | null | undefined, prefix: string) {
  const arr = Array.isArray(tags) ? tags : []
  return arr
    .filter((t) => typeof t === "string" && t.startsWith(prefix))
    .map((t) => String(t).slice(prefix.length))
    .filter(Boolean)
}

export function OnboardingFlow() {
  const router = useRouter()
  const search = useSearchParams()
  const { session, loading } = useSupabaseSession()
  const accessToken = session?.access_token
  const returnTo = useMemo(() => sanitizeReturnTo(search.get("returnTo"), "/dashboard/jobs"), [search])

  const [step, setStep] = useState<Step>("gate")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [parsingJob, setParsingJob] = useState<ParsingJob | null>(null)

  const [logisticsConnected, setLogisticsConnected] = useState<LogisticsConnected>("unknown")
  const [domain, setDomain] = useState<string>("")
  const [mode, setMode] = useState<string>("")
  const [categories, setCategories] = useState<string[]>([])

  const steps = useMemo(() => {
    if (logisticsConnected === "yes") {
      return [
        { id: "gate", label: "1. Your industry" },
        { id: "specialization", label: "2. Specialization" },
        { id: "resume", label: "3. Resume" },
        { id: "profile", label: "4. Profile" }
      ] as const
    }
    return [
      { id: "gate", label: "1. Your industry" },
      { id: "resume", label: "2. Resume" },
      { id: "profile", label: "3. Profile" }
    ] as const
  }, [logisticsConnected])

  const fetchProfile = useCallback(async () => {
    if (!accessToken) return
    setCandidateLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/candidate/profile", { headers: bearerHeaders(accessToken) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to load profile")
      setCandidate(data.candidate || null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCandidateLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    if (!accessToken || !parsingJob?.id) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (stopped) return
      try {
        const res = await fetch(`/api/candidate/resume/status?parsing_job_id=${parsingJob.id}`, {
          headers: bearerHeaders(accessToken)
        })
        const data = await res.json()
        if (res.ok && data?.parsingJob) {
          const next = data.parsingJob as ParsingJob
          setParsingJob(next)
          if (next.status === "completed" || next.status === "failed") {
            await fetchProfile()
            return
          }
        }
      } catch {
      }
      timer = setTimeout(poll, 2000)
    }

    poll()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [accessToken, parsingJob?.id, fetchProfile])

  useEffect(() => {
    if (!accessToken) return
    fetchProfile()
  }, [accessToken, fetchProfile])

  useEffect(() => {
    const tags = (candidate as any)?.tags as any
    const connected = readTaggedPrefix(tags, "logistics_connected=")[0]
    if (connected === "yes") setLogisticsConnected("yes")
    else if (connected === "no") setLogisticsConnected("no")
    else setLogisticsConnected("unknown")

    const d = readTaggedPrefix(tags, "logistics_domain=")[0] || ""
    const m = readTaggedPrefix(tags, "logistics_mode=")[0] || ""
    const cs = readTaggedPrefix(tags, "logistics_category=")
    setDomain(d)
    setMode(m)
    setCategories(cs)

    if (connected === "no") {
      setStep("resume")
    } else if (connected === "yes") {
      if (!d || !m || !cs.length) setStep("specialization")
      else setStep("resume")
    } else {
      setStep("gate")
    }
  }, [candidate])

  useEffect(() => {
    if (!accessToken) return
    if (candidate || candidateLoading) return
    const metaName = (session?.user?.user_metadata as any)?.full_name || (session?.user?.user_metadata as any)?.name
    if (!metaName || typeof metaName !== "string") return

    ;(async () => {
      try {
        const res = await fetch("/api/candidate/profile", {
          method: "PUT",
          headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
          body: JSON.stringify({
            name: metaName,
            current_role: "Candidate",
            total_experience: "0",
            location: "Unknown"
          })
        })
        const data = await res.json()
        if (res.ok && data?.candidate) setCandidate(data.candidate)
      } catch {
        return
      }
    })()
  }, [accessToken, candidate, candidateLoading, session])

  const uploadAndParse = async (file: File) => {
    if (!accessToken) return
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("resume", file)
      const res = await fetch("/api/candidate/resume/parse", {
        method: "POST",
        body: fd,
        headers: bearerHeaders(accessToken)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to parse")
      if (data.candidate) setCandidate(data.candidate)
      if (data.parsingJob) setParsingJob(data.parsingJob)
      setStep("profile")
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const parseExisting = async () => {
    if (!accessToken) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/candidate/resume/reparse", { method: "POST", headers: bearerHeaders(accessToken) })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Failed to start parsing")
      if (data?.parsingJob) setParsingJob(data.parsingJob)
      setStep("profile")
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const saveGate = async (next: LogisticsConnected) => {
    if (!accessToken) return
    if (!candidate) {
      setError("Profile is not ready yet. Please try again in a moment.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updatedTags = upsertTaggedPrefix(candidate.tags as any, "logistics_connected=", [next])
      const res = await fetch("/api/candidate/profile", {
        method: "PUT",
        headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ tags: updatedTags })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Failed to save")
      setCandidate((data?.candidate || null) as Candidate | null)
      if (next === "yes") setStep("specialization")
      else setStep("resume")
    } catch (e: any) {
      setError(e.message || "Failed")
    } finally {
      setBusy(false)
    }
  }

  const saveSpecialization = async () => {
    if (!accessToken) return
    if (!candidate) {
      setError("Profile is not ready yet. Please try again in a moment.")
      return
    }
    if (!domain || !mode || !categories.length) {
      setError("Select your domain, mode, and at least one specialization.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      let tags = Array.isArray(candidate.tags) ? (candidate.tags as any as string[]) : []
      tags = upsertTaggedPrefix(tags, "logistics_domain=", [domain])
      tags = upsertTaggedPrefix(tags, "logistics_mode=", [mode])
      tags = upsertTaggedPrefix(tags, "logistics_category=", categories)

      const res = await fetch("/api/candidate/profile", {
        method: "PUT",
        headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ tags })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Failed to save")
      setCandidate((data?.candidate || null) as Candidate | null)
      setStep("resume")
    } catch (e: any) {
      setError(e.message || "Failed")
    } finally {
      setBusy(false)
    }
  }

  const saveProfile = async (next: Candidate) => {
    if (!accessToken) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/candidate/profile", {
        method: "PUT",
        headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: next.name,
          email: next.email,
          phone: next.phone,
          looking_for_work: next.looking_for_work,
          current_salary: next.current_salary,
          expected_salary: next.expected_salary,
          tags: next.tags
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save")
      setCandidate(data.candidate)
      router.push(returnTo)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!accessToken) {
    return (
      <div className="rounded-3xl border bg-card p-8">
        {loading ? <Spinner /> : <div className="text-sm">Unauthorized</div>}
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-64px)] px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <div className="text-2xl font-semibold tracking-tight">Finish setting up your profile</div>
          <div className="mt-1 text-sm text-muted-foreground">Upload a resume to autofill, or continue manually.</div>
          {returnTo.includes("/apply") ? (
            <div className="mt-3 rounded-2xl border bg-accent px-4 py-3 text-sm">
              You’ll return to your application after completing your profile.
            </div>
          ) : null}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {steps.map((s) => (
            <Badge key={s.id} className={step === s.id ? "bg-primary/5 border-primary/20 text-foreground" : ""}>
              {s.label}
            </Badge>
          ))}
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/jobs")}>
              Skip for now
            </Button>
          </div>
        </div>

        {error ? <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">{error}</div> : null}

        {step === "gate" ? (
          <IndustryGateStep
            value={logisticsConnected}
            busy={busy}
            disabled={candidateLoading || !candidate}
            onChange={setLogisticsConnected}
            onSkip={() => {
              setLogisticsConnected("no")
              saveGate("no")
            }}
            onContinue={() => saveGate(logisticsConnected)}
          />
        ) : null}

        {step === "specialization" ? (
          <SpecializationStep
            domain={domain}
            mode={mode}
            categories={categories}
            domains={DOMAINS.slice() as any}
            modes={MODES.slice() as any}
            modeCategories={MODE_CATEGORIES}
            busy={busy}
            onBack={() => setStep("gate")}
            onSetDomain={(v) => setDomain(v)}
            onSetMode={(v) => {
              setMode(v)
              setCategories([])
            }}
            onToggleCategory={(id) => setCategories((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
            onContinue={saveSpecialization}
          />
        ) : null}

        {step === "resume" ? (
          <ResumeStep
            candidate={candidate}
            candidateLoading={candidateLoading}
            busy={busy}
            parsingJob={parsingJob}
            onError={setError}
            onUploadAndParse={uploadAndParse}
            onParseExisting={parseExisting}
            onSkip={() => setStep("profile")}
          />
        ) : null}

        {step === "profile" ? (
          <div className="grid gap-4">
            <ProfileStep
              candidate={candidate}
              setCandidate={(next) => setCandidate(next)}
              busy={busy}
              onBack={() => setStep("resume")}
              onContinue={() => {
                if (!candidate) return
                saveProfile(candidate)
              }}
            />
            <div className="rounded-2xl border bg-accent px-4 py-3 text-xs text-muted-foreground">
              Your profile will be used to prefill applications and show invites.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
