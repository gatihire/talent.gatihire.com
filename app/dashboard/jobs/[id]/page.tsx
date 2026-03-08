import { notFound } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import type { Job, JobSection } from "@/lib/types"
import { JobApplyPageClient } from "@/components/jobs/JobApplyPageClient"

export const runtime = "nodejs"
export const revalidate = 0

export default async function DashboardJobPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params

  const { data: jobRow } = await supabaseAdmin.from("jobs").select("*").eq("id", id).single()
  if (!jobRow) notFound()
  const job = jobRow as Job & { client_id?: string | null; client_name?: string | null }

  const { data: sectionsData } = await supabaseAdmin
    .from("job_sections")
    .select("id,job_id,section_key,heading,body_md,sort_order,is_visible")
    .eq("job_id", id)
    .order("sort_order", { ascending: true })

  const sections = (sectionsData || []) as JobSection[]

  let client: {
    name: string
    slug: string | null
    logo_url: string | null
    website?: string | null
    company_type?: string | null
    location?: string | null
    open_jobs_count?: number
  } | null = null

  if ((job as any).client_id) {
    const { data } = await supabaseAdmin
      .from("clients")
      .select("id,name,slug,logo_url,website,company_type,location")
      .eq("id", (job as any).client_id)
      .maybeSingle()

    if (data?.id) {
      const { count } = await supabaseAdmin
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .eq("client_id", data.id)
      client = { ...(data as any), open_jobs_count: count || 0 }
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <JobApplyPageClient job={job} client={client} sections={sections} backHref="/dashboard/jobs" />
    </main>
  )
}

