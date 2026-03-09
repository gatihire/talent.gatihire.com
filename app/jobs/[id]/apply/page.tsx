import { redirect } from "next/navigation"

export const revalidate = 0

export default async function JobApplyPage(props: {
  params: Promise<{ id: string }>
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const { id } = await props.params
  const sp = props.searchParams || {}
  const invite = typeof sp.invite === "string" ? sp.invite : Array.isArray(sp.invite) ? sp.invite[0] : ""
  redirect(`/jobs/${id}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`)
}
