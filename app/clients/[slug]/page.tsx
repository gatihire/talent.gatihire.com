import Link from "next/link"
import { notFound } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import type { Job } from "@/lib/types"
import { PublicTopNav } from "@/components/public/PublicTopNav"
import { JobCard } from "@/components/jobs/JobCard"
import { ExpandableText } from "@/components/ui/ExpandableText"

export const runtime = "nodejs"
export const revalidate = 0

export default async function ClientPublicPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id,slug,name,about,website,company_type,location,logo_url")
    .eq("slug", slug)
    .maybeSingle()
  if (!client?.id) notFound()

  const { data: jobs } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("status", "open")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })

  const typedJobs = (jobs || []) as Job[]

  return (
    <div>
      <PublicTopNav minimal />

      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="rounded-3xl border bg-card p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {client.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={client.name} src={client.logo_url} className="h-14 w-14 rounded-3xl border bg-background object-cover" />
              ) : (
                <div className="h-14 w-14 rounded-3xl border bg-background" />
              )}
              <div>
                <div className="text-2xl font-semibold tracking-tight">{client.name}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {client.location ? <span>{client.location}</span> : null}
                  {client.company_type ? <span>{client.location ? " • " : ""}{client.company_type}</span> : null}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {client.website ? (
                <a className="rounded-full border bg-card px-4 py-2 text-sm hover:bg-accent" href={client.website} target="_blank" rel="noopener noreferrer">
                  Website
                </a>
              ) : null}
              <Link className="rounded-full border bg-card px-4 py-2 text-sm hover:bg-accent" href="/jobs">
                Browse all jobs
              </Link>
            </div>
          </div>

          {client.about ? (
            <div className="mt-5 max-w-3xl">
              <ExpandableText text={client.about} collapsedChars={520} />
            </div>
          ) : null}
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between">
            <div className="text-lg font-semibold">Open roles</div>
            <div className="text-sm text-muted-foreground">{typedJobs.length} open jobs</div>
          </div>
          <div className="mt-4 grid gap-4">
            {typedJobs.length ? (
              typedJobs.map((j) => (
                <JobCard
                  key={j.id}
                  job={j as any}
                  client={{ name: client.name, slug: client.slug, logo_url: client.logo_url }}
                  ctaLabel="View job"
                />
              ))
            ) : (
              <div className="rounded-3xl border bg-card p-8 text-sm text-muted-foreground">No open jobs assigned yet.</div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
