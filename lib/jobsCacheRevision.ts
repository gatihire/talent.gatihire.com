import { supabaseAdmin } from "@/lib/supabaseAdmin"

export const JOBS_SEARCH_REV_KEY = "jobs_search_rev"

const REV_MEMO_TTL_MS = 2_000
let revMemo: { value: number; at: number } | null = null

export async function getJobsSearchRevision(): Promise<number> {
  const now = Date.now()
  if (revMemo && now - revMemo.at < REV_MEMO_TTL_MS) return revMemo.value
  try {
    const { data, error } = await supabaseAdmin.rpc("get_app_meta", { p_key: JOBS_SEARCH_REV_KEY })
    const value = error ? 0 : Number(data ?? 0) || 0
    revMemo = { value, at: now }
    return value
  } catch {
    return revMemo?.value ?? 0
  }
}

export async function bumpJobsSearchRevision(): Promise<void> {
  try {
    await supabaseAdmin.rpc("increment_app_meta", { p_key: JOBS_SEARCH_REV_KEY, p_delta: 1 })
    revMemo = null
  } catch {
    // best-effort; cached entries self-heal via their TTL
  }
}