import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const revalidate = 0

export default async function InviteRedirectPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params

  const { data: invite } = await supabaseAdmin
    .from("job_invites")
    .select("id, job_id, status, opened_at")
    .eq("token", token)
    .maybeSingle()

  if (!invite?.job_id) redirect("/jobs")

  const now = new Date().toISOString()
  if (!invite.opened_at) {
    const nextStatus = invite.status === "sent" ? "opened" : invite.status
    await supabaseAdmin
      .from("job_invites")
      .update({ opened_at: now, status: nextStatus, updated_at: now })
      .eq("id", invite.id)
  }

  redirect(`/jobs/${invite.job_id}${token ? `?invite=${encodeURIComponent(token)}` : ""}`)
}

