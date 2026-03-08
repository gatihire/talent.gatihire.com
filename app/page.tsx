import { redirect } from "next/navigation"
import { createSupabaseServerClientReadonly } from "@/lib/supabaseSsr"

export default async function Root() {
  const supabase = createSupabaseServerClientReadonly()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (user) {
    redirect("/dashboard/jobs")
  }

  redirect("/jobs?login=1")
}
