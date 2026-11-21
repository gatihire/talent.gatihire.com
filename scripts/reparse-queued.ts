#!/usr/bin/env npx tsx
/**
 * Re-parse resumes that were uploaded but never read.
 *
 * WHY THIS EXISTS
 *
 * Resume parsing used to be handed to a background worker (the `board-worker`
 * Fly app). While that worker was not running, every upload still saved the
 * file and created a `parsing_jobs` row — but nothing ever picked the job up,
 * so the candidate was left with `resume_parse_state = 'queued'` and an empty
 * profile. The file was safe; it was simply never read.
 *
 * Parsing now runs inline inside the upload request, so this cannot happen to
 * new uploads. This script repairs the candidates it already happened to by
 * running the exact same code the API route runs — `ingestResume` followed by
 * `writeIngestToCandidate` — so the result is identical to a fresh upload.
 *
 * USAGE
 *
 *   npx tsx --env-file=.env.local scripts/reparse-queued.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/reparse-queued.ts
 *   npx tsx --env-file=.env.local scripts/reparse-queued.ts --limit 10
 *   npx tsx --env-file=.env.local scripts/reparse-queued.ts --state needs_review
 *
 * SAFE TO RE-RUN: it only selects candidates whose resume has not been parsed.
 */

import { supabaseAdmin } from "../lib/supabaseAdmin"
import { ingestResume } from "../lib/resume-ingest"
import { writeIngestToCandidate, downloadResumeAsFile, finalizeParsingJob } from "../lib/resume-upload"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const limitArg = args.indexOf("--limit")
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) || 50 : 50
const stateArg = args.indexOf("--state")
const state = stateArg >= 0 ? String(args[stateArg + 1] || "queued") : "queued"

type Row = {
  id: string
  email: string | null
  file_name: string | null
  file_url: string | null
  resume_parse_state: string | null
}

async function main() {
  const { data, error } = await supabaseAdmin
    .from("candidates")
    .select("id,email,file_name,file_url,resume_parse_state")
    .eq("resume_parse_state", state)
    .not("file_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("Could not list candidates:", error.message)
    process.exit(1)
  }

  const rows = (data ?? []) as Row[]
  console.log(`candidates in state "${state}": ${rows.length}${dryRun ? " (dry run)" : ""}`)
  if (!rows.length) return

  let ok = 0
  let review = 0
  let failed = 0

  for (const row of rows) {
    const label = `${row.email || row.id} — ${row.file_name || "resume"}`

    const { data: fileRow } = await supabaseAdmin
      .from("file_storage")
      .select("id,file_name,file_url,file_type,file_size,original_path")
      .eq("candidate_id", row.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!fileRow) {
      console.log(`  skip   ${label} (no file_storage row)`)
      failed++
      continue
    }

    if (dryRun) {
      console.log(`  would  ${label}`)
      continue
    }

    const startedAt = Date.now()
    try {
      const { file } = await downloadResumeAsFile(
        String(fileRow.original_path || ""),
        typeof fileRow.file_url === "string" ? fileRow.file_url : row.file_url,
        String(fileRow.file_name || row.file_name || "resume"),
        typeof fileRow.file_type === "string" ? fileRow.file_type : null,
      )

      let result: any = null
      let parseError: string | null = null
      try {
        result = await ingestResume(file)
      } catch (e: any) {
        parseError = e?.message || String(e)
      }

      const write = await writeIngestToCandidate(
        row.id,
        {
          name: String(fileRow.file_name || row.file_name || "resume"),
          type: typeof fileRow.file_type === "string" ? fileRow.file_type : null,
          size: typeof fileRow.file_size === "number" ? fileRow.file_size : null,
          url: typeof fileRow.file_url === "string" ? fileRow.file_url : row.file_url,
        },
        result,
        parseError,
      )

      // Close any parsing job that is still open for this candidate.
      const { data: openJobs } = await supabaseAdmin
        .from("parsing_jobs")
        .select("id")
        .eq("candidate_id", row.id)
        .in("status", ["pending", "processing"])
      for (const job of openJobs ?? []) {
        await finalizeParsingJob(String((job as any).id), write.state, write.error || parseError)
      }

      const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
      if (write.state === "needs_review") {
        review++
        console.log(`  review ${label} (${secs}s) — ${write.error || parseError || "unreadable"}`)
      } else {
        ok++
        console.log(`  ok     ${label} (${secs}s) — ${write.state}`)
      }
    } catch (e: any) {
      failed++
      console.log(`  FAIL   ${label} — ${e?.message || e}`)
    }
  }

  console.log(`\ndone: ${ok} parsed, ${review} needs review, ${failed} failed`)
}

main()
