"use client"

import { useEffect, useMemo, useState } from "react"
import { Modal } from "@/components/ui/Modal"
import { Button } from "@/components/ui/Button"
import { Spinner } from "@/components/ui/Spinner"
import { useSupabaseSession } from "@/lib/useSupabaseSession"
import { bearerHeaders } from "@/lib/http"

type Availability = {
  looking_for_work: boolean
  open_job_types: string[]
  available_start_time: string | null
  available_end_time: string | null
  work_timezone: string | null
  preferred_location: string
  current_salary: string | null
  expected_salary: string | null
  notice_period: string | null
  available_start_date: string | null
  availability_notes: string | null
}

const JOB_TYPES = [
  { id: "full_time", label: "Full time roles" },
  { id: "part_time", label: "Part time roles" },
  { id: "direct_hire", label: "Employee (direct hire) roles" },
  { id: "contract", label: "Contract roles" }
]

const TIME_OPTIONS = [
  "7:00 AM",
  "8:00 AM",
  "9:00 AM",
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "1:00 PM",
  "2:00 PM",
  "3:00 PM",
  "4:00 PM",
  "5:00 PM",
  "6:00 PM",
  "7:00 PM"
]

const TZ_OPTIONS = [
  "Indian Standard Time (IST)",
  "Sri Lanka Time (SLST)",
  "UTC",
  "US Eastern Time (ET)",
  "US Pacific Time (PT)",
  "Europe Central Time (CET)",
]

const LOCATION_PRESETS = [
  "Anywhere in India",
  "Delhi NCR",
  "Mumbai",
  "Bengaluru",
  "Hyderabad",
  "Chennai",
  "Pune",
  "Ahmedabad",
  "Kolkata",
  "Jaipur",
  "Surat",
  "Indore",
  "Lucknow"
]

function splitLocations(raw: string) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    )
  ).slice(0, 8)
}

export function WorkAvailabilityModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useSupabaseSession()
  const accessToken = session?.access_token

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [data, setData] = useState<Availability>({
    looking_for_work: true,
    open_job_types: ["full_time", "part_time", "direct_hire"],
    available_start_time: "9:00 AM",
    available_end_time: "5:00 PM",
    work_timezone: TZ_OPTIONS[0],
    preferred_location: "",
    current_salary: "",
    expected_salary: "",
    notice_period: "",
    available_start_date: "",
    availability_notes: ""
  })
  const [prefLocs, setPrefLocs] = useState<string[]>([])
  const [prefLocInput, setPrefLocInput] = useState("")
  const [prefLocFocused, setPrefLocFocused] = useState(false)

  useEffect(() => {
    if (!open) return
    if (!accessToken) return
    setLoading(true)
    setError(null)
    fetch("/api/candidate/availability", { headers: bearerHeaders(accessToken) })
      .then(async (r) => {
        const j = await r.json().catch(() => null)
        if (!r.ok) throw new Error(j?.error || "Failed to load")
        return j?.availability
      })
      .then((av) => {
        if (!av) return
        setData({
          looking_for_work: Boolean(av.looking_for_work),
          open_job_types: Array.isArray(av.open_job_types) ? av.open_job_types : [],
          available_start_time: av.available_start_time || "9:00 AM",
          available_end_time: av.available_end_time || "5:00 PM",
          work_timezone: av.work_timezone || TZ_OPTIONS[0],
          preferred_location: av.preferred_location || "",
          current_salary: av.current_salary || "",
          expected_salary: av.expected_salary || "",
          notice_period: av.notice_period || "",
          available_start_date: av.available_start_date || "",
          availability_notes: av.availability_notes || ""
        })
        setPrefLocs(splitLocations(av.preferred_location || ""))
      })
      .catch((e) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false))
  }, [open, accessToken])

  const toggleJobType = (id: string) => {
    setData((prev) => {
      const set = new Set(prev.open_job_types)
      if (set.has(id)) set.delete(id)
      else set.add(id)
      return { ...prev, open_job_types: Array.from(set) }
    })
  }

  const prefLocTypeahead = useMemo(() => {
    const q = prefLocInput.trim().toLowerCase()
    if (!q) return [] as string[]
    const taken = new Set(prefLocs.map((x) => x.toLowerCase()))
    return LOCATION_PRESETS.filter((x) => x.toLowerCase().includes(q) && !taken.has(x.toLowerCase())).slice(0, 10)
  }, [prefLocInput, prefLocs])

  const addPrefLoc = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    setPrefLocs((prev) => Array.from(new Set([...prev, t])).slice(0, 8))
    setPrefLocInput("")
  }

  const removePrefLoc = (v: string) => {
    setPrefLocs((prev) => prev.filter((x) => x !== v))
  }

  const canSave = useMemo(() => {
    if (!data.looking_for_work) return true
    if (!data.open_job_types.length) return false
    if (!data.available_start_time || !data.available_end_time) return false
    if (!data.work_timezone) return false
    return true
  }, [data])

  const save = async () => {
    if (!accessToken) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/candidate/availability", {
        method: "PUT",
        headers: bearerHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          ...data,
          preferred_location: prefLocs.join(", ")
        })
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || "Failed to save")
      onClose()
    } catch (e: any) {
      setError(e.message || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Set your work availability" size="lg">
      <div className="grid gap-4">
        <div className="text-sm text-muted-foreground">
          If you’re looking for work, select the job types and hours you’re open to working, and it’ll appear on your profile.
        </div>

        {error ? <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">{error}</div> : null}

        <label className="flex items-center justify-between rounded-2xl border bg-card px-4 py-3">
          <div className="text-sm font-medium">I’m looking for work</div>
          <input
            type="checkbox"
            checked={data.looking_for_work}
            onChange={(e) => setData((p) => ({ ...p, looking_for_work: e.target.checked }))}
          />
        </label>

        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">Job types I’m open to:</div>
          <div className="grid gap-2">
            {JOB_TYPES.map((t) => (
              <label key={t.id} className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm">
                <input type="checkbox" checked={data.open_job_types.includes(t.id)} onChange={() => toggleJobType(t.id)} disabled={!data.looking_for_work} />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">Hours I’m available to work:</div>
          <div className="rounded-2xl border bg-card p-4">
            <div className="text-sm font-medium">Working hours</div>
            <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <select
                value={data.available_start_time || ""}
                onChange={(e) => setData((p) => ({ ...p, available_start_time: e.target.value }))}
                disabled={!data.looking_for_work}
                className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div className="text-sm text-muted-foreground">to</div>
              <select
                value={data.available_end_time || ""}
                onChange={(e) => setData((p) => ({ ...p, available_end_time: e.target.value }))}
                disabled={!data.looking_for_work}
                className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-5 text-sm font-medium">Timezone</div>
            <select
              value={data.work_timezone || ""}
              onChange={(e) => setData((p) => ({ ...p, work_timezone: e.target.value }))}
              disabled={!data.looking_for_work}
              className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              {TZ_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className="mt-2 text-xs text-muted-foreground">By default, we assume you work in your location’s timezone.</div>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">Preferred locations</div>
          <div className="relative">
            <div className="rounded-2xl border border-input bg-background px-4 py-2 focus-within:ring-2 focus-within:ring-ring/20">
              <div className="flex flex-wrap items-center gap-2">
                {prefLocs.map((v) => (
                  <button
                    key={`pl:${v}`}
                    type="button"
                    onClick={() => removePrefLoc(v)}
                    className="inline-flex items-center gap-2 rounded-full border bg-accent px-3 py-1 text-xs"
                  >
                    <span className="max-w-[180px] truncate">{v}</span>
                    <span className="text-muted-foreground">×</span>
                  </button>
                ))}
                <input
                  value={prefLocInput}
                  onChange={(e) => setPrefLocInput(e.target.value)}
                  onFocus={() => setPrefLocFocused(true)}
                  onBlur={() => window.setTimeout(() => setPrefLocFocused(false), 120)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addPrefLoc(prefLocInput)
                    }
                  }}
                  disabled={!data.looking_for_work}
                  placeholder={prefLocs.length ? "Add location" : "Add preferred locations"}
                  className="min-w-[140px] flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
            </div>
            {prefLocFocused && prefLocInput.trim() && prefLocTypeahead.length ? (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border bg-background shadow-lg">
                {prefLocTypeahead.map((opt) => (
                  <button
                    key={`prefLoc:${opt}`}
                    type="button"
                    onClick={() => addPrefLoc(opt)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-accent"
                  >
                    <span className="truncate">{opt}</span>
                    <span className="text-xs text-muted-foreground">Add</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">Used for better job matching and recruiter filters.</div>
        </div>

        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">Start date</div>
          <input
            type="date"
            value={data.available_start_date || ""}
            onChange={(e) => setData((p) => ({ ...p, available_start_date: e.target.value }))}
            disabled={!data.looking_for_work}
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
          />
        </div>

        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">Compensation</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              value={data.current_salary || ""}
              onChange={(e) => setData((p) => ({ ...p, current_salary: e.target.value }))}
              placeholder="Current salary"
              className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
            />
            <input
              value={data.expected_salary || ""}
              onChange={(e) => setData((p) => ({ ...p, expected_salary: e.target.value }))}
              placeholder="Expected salary"
              className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
            />
            <input
              value={data.notice_period || ""}
              onChange={(e) => setData((p) => ({ ...p, notice_period: e.target.value }))}
              placeholder="Notice period"
              className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
            />
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">Availability notes</div>
          <textarea
            value={data.availability_notes || ""}
            onChange={(e) => setData((p) => ({ ...p, availability_notes: e.target.value }))}
            placeholder="Share any notes about shift preferences or constraints"
            className="min-h-[120px] rounded-2xl border border-input bg-background px-4 py-3 text-sm"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={!accessToken || saving || loading || !canSave}>
            {saving || loading ? <Spinner /> : null}
            Save my availability
          </Button>
        </div>
      </div>
    </Modal>
  )
}
