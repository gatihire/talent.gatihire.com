import type { Job } from "@/lib/types"
import { PublicTopNav } from "@/components/public/PublicTopNav"
import { JobCard } from "@/components/jobs/JobCard"
import { Pagination } from "@/components/jobs/Pagination"
import { JobsFilters } from "@/components/jobs/JobsFilters"
import { BRAND_NAME } from "@/lib/branding"

type ClientLite = { id: string; name: string; slug: string | null; logo_url: string | null }

export function PublicJobsPage({
  jobs,
  clients,
  page,
  totalPages,
  totalCount,
  filters
}: {
  jobs: Job[]
  clients: Record<string, ClientLite>
  page: number
  totalPages: number
  totalCount: number
  filters: { q: string; role: string; location: string; jobType: string; skills: string[] }
}) {
  return (
    <div>
      <PublicTopNav />

      <div className="bg-gradient-to-b from-[#F3F2FF] to-background">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{BRAND_NAME} finds logistics jobs that work for you</h1>
            <p className="mt-4 text-sm text-muted-foreground sm:text-base">
              Create a free profile to access jobs in fleet operations, dispatch, warehouse, supply chain, and more.
            </p>
          </div>

          <div className="mt-10 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
            <div className="rounded-full border bg-card px-4 py-2">Role</div>
            <div className="rounded-full border bg-card px-4 py-2">Skills</div>
            <div className="rounded-full border bg-card px-4 py-2">Location</div>
            <div className="rounded-full border bg-card px-4 py-2">Commitment</div>
            <div className="rounded-full border bg-card px-4 py-2">Job type</div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-10">
        <div className="-mt-6">
          <JobsFilters initial={{ q: filters.q, role: filters.role, skills: filters.skills, location: filters.location, jobType: filters.jobType }} />
        </div>

        <div className="py-4 text-sm text-muted-foreground">{totalCount.toLocaleString()} job openings</div>
        <div className="grid gap-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job as any} client={(job as any).client_id ? clients[(job as any).client_id] : null} ctaLabel="Apply" />
          ))}
        </div>

        <Pagination basePath="/jobs" page={page} totalPages={totalPages} />
      </div>
    </div>
  )
}
