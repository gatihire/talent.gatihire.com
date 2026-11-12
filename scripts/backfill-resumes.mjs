#!/usr/bin/env node
/**
 * Resume backfill — the recovery job for the candidate database.
 *
 * THE PROBLEM THIS FIXES
 *
 * Three separate defects left holes in the candidate table:
 *
 *   1. The public apply path never wrote an embedding. Candidates who
 *      applied through the talent site were invisible to vector search.
 *      ~1,300 rows had resume_text but embedding = NULL.
 *
 *   2. 385 parse jobs sat in `resume_parse_jobs` with status 'queued'
 *      since April. The worker was never fed by the apply path, so these
 *      were mostly duplicate "parse existing" clicks that would have
 *      re-parsed candidates who were already fine.
 *
 *   3. Candidates whose resume could not be read were left indistinguishable
 *      from candidates who never uploaded one. Now tracked by
 *      `resume_parse_state`.
 *
 * WHAT IT DOES
 *
 *   --embeddings   Generate embeddings for every candidate that has
 *                  resume_text but no embedding. This is the big win:
 *                  it makes ~1,300 candidates searchable again.
 *
 *   --requeue      Re-queue the genuinely-unparsed candidates (the ones
 *                  in 'needs_review') so the worker can retry them.
 *
 *   --stale        Mark queued jobs for already-parsed candidates as
 *                  'succeeded' — they are no-ops, and leaving them queued
 *                  makes the queue look permanently backed up.
 *
 *   --all          All of the above.
 *
 * USAGE
 *
 *   node --env-file=.env.local scripts/backfill-resumes.mjs --embeddings
 *   node --env-file=.env.local scripts/backfill-resumes.mjs --all --limit 100
 *
 * SAFE TO RE-RUN. It only touches candidates that still need work.
 */

import { createClient } from "@supabase/supabase-js"

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const GEMINI_KEY = process.env.GEMINI_API_KEY

if (!URL || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM || 768)
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001"

const args = process.argv.slice(2)
const wants = (f) => args.includes(f)
const limitArg = args.indexOf("--limit")
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) || 100 : 100
const dryRun = wants("--dry-run")

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Generate one embedding. Mirrors lib/embedding.ts but with explicit
 * error reporting and a real retry — the production version swallowed
 * every failure and returned [], which is how 1,300 candidates ended up
 * without a vector in the first place.
 */
async function generateEmbedding(text) {
  const input = String(text || "").trim().slice(0, 8000)
  if (!input || !GEMINI_KEY) return []

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`
  const makeBody = (includeDim) => {
    const body = { model: `models/${EMBEDDING_MODEL}`, content: { parts: [{ text: input }] } }
    if (includeDim) body.output_dimensionality = EMBEDDING_DIM
    return body
  }

  const doRequest = async (body) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = json?.error?.message || res.statusText || "Embedding request failed"
      const err = new Error(`[Gemini ${res.status}] ${msg}`)
      err.status = res.status
      throw err
    }
    const values =
      json?.embedding?.values || json?.embeddings?.[0]?.values || json?.data?.[0]?.embedding?.values
    if (!Array.isArray(values)) return []
    const vec = values.map(Number).filter(Number.isFinite)
    if (!Number.isFinite(EMBEDDING_DIM) || EMBEDDING_DIM <= 0) return vec
    if (vec.length > EMBEDDING_DIM) return vec.slice(0, EMBEDDING_DIM)
    if (vec.length < EMBEDDING_DIM) return [...vec, ...Array(EMBEDDING_DIM - vec.length).fill(0)]
    return vec
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await doRequest(makeBody(true))
    } catch (e) {
      const status = Number(e?.status || 0)
      const msg = String(e?.message || e)
      if (status === 400 && /dimension|output_dimensionality|invalid value|unsupported/i.test(msg)) {
        try {
          return await doRequest(makeBody(false))
        } catch {
          return []
        }
      }
      if (status === 429 || status === 503 || status === 504) {
        await sleep(800 * Math.pow(2, attempt) + Math.floor(Math.random() * 300))
        continue
      }
      console.error(`  ! ${msg}`)
      return []
    }
  }
  return []
}

function buildEmbeddingInput(row) {
  return [
    row.current_role,
    row.desired_role,
    row.current_company,
    row.location,
    row.summary,
    row.resume_text,
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join("\n")
}

async function backfillEmbeddings() {
  console.log("\n=== Embedding backfill ===")
  if (!GEMINI_KEY) {
    console.error("GEMINI_API_KEY not set — cannot generate embeddings")
    return
  }

  const { data: rows, error } = await supabase
    .from("candidates")
    .select("id,resume_text,summary,current_role,desired_role,current_company,location,resume_parse_state")
    .is("embedding", null)
    .not("resume_text", "is", null)
    .order("uploaded_at", { ascending: false })
    .limit(LIMIT)

  if (error) {
    console.error("load failed:", error.message)
    return
  }
  console.log(`candidates with text but no embedding: ${rows.length}`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const input = buildEmbeddingInput(row)
    if (input.length < 50) {
      skipped++
      continue
    }

    const embedding = await generateEmbedding(input)
    if (!embedding.length || embedding.length !== EMBEDDING_DIM) {
      failed++
      console.log(`  x ${row.id.slice(0, 8)} — embedding failed`)
      continue
    }

    if (dryRun) {
      updated++
      console.log(`  · ${row.id.slice(0, 8)} — would update (${i + 1}/${rows.length})`)
      continue
    }

    const { error: updErr } = await supabase
      .from("candidates")
      .update({ embedding, updated_at: new Date().toISOString() })
      .eq("id", row.id)

    if (updErr) {
      failed++
      console.log(`  x ${row.id.slice(0, 8)} — ${updErr.message}`)
    } else {
      updated++
      if ((i + 1) % 25 === 0 || i === rows.length - 1) {
        console.log(`  ✓ ${i + 1}/${rows.length} — updated ${updated}, skipped ${skipped}, failed ${failed}`)
      }
    }

    // Be gentle with the embedding API — it rate-limits hard.
    await sleep(60)
  }

  console.log(`embedding backfill done: updated ${updated}, skipped ${skipped}, failed ${failed}`)
}

async function markStaleJobs() {
  console.log("\n=== Clearing stale queued jobs ===")
  // A queued job for a candidate who is already 'parsed' is a duplicate
  // "parse existing" click. Re-parsing them would burn Gemini quota for
  // no benefit and keep the queue looking permanently backed up.
  //
  // We fetch the queued jobs and their candidates' states separately
  // rather than a giant `.in()` — PostgREST puts the filter in the URL,
  // and a thousand UUIDs overflows it.
  const { data: queued, error } = await supabase
    .from("resume_parse_jobs")
    .select("id,candidate_id")
    .eq("status", "queued")

  if (error) {
    console.error("load failed:", error.message)
    return
  }
  if (!queued.length) {
    console.log("nothing to clear")
    return
  }

  const candidateIds = [...new Set(queued.map((j) => j.candidate_id))]
  const { data: parsedRows, error: pErr } = await supabase
    .from("candidates")
    .select("id,resume_parse_state")
    .in("id", candidateIds)

  if (pErr) {
    console.error("candidate load failed:", pErr.message)
    return
  }

  const parsedSet = new Set(
    (parsedRows || []).filter((c) => c.resume_parse_state === "parsed").map((c) => c.id),
  )
  const stale = queued.filter((j) => parsedSet.has(j.candidate_id))

  console.log(`queued jobs: ${queued.length}; already-parsed (no-op): ${stale.length}`)

  if (!stale.length) return
  if (dryRun) {
    console.log(`  (dry run — would mark ${stale.length} as succeeded)`)
    return
  }

  // Chunk the updates so no single request carries a huge id list.
  const CHUNK = 100
  let done = 0
  for (let i = 0; i < stale.length; i += CHUNK) {
    const chunk = stale.slice(i, i + CHUNK)
    const { error: updErr } = await supabase
      .from("resume_parse_jobs")
      .update({
        status: "succeeded",
        error: "skipped: candidate already parsed",
        updated_at: new Date().toISOString(),
      })
      .in("id", chunk.map((s) => s.id))
    if (updErr) console.error(`  ! chunk ${i / CHUNK + 1} failed: ${updErr.message}`)
    else done += chunk.length
  }
  console.log(`  ✓ marked ${done} as succeeded`)
}

async function requeueNeedsReview() {
  console.log("\n=== Re-queuing resumes that need review ===")
  const { data: cands, error } = await supabase
    .from("candidates")
    .select("id,file_name,file_url")
    .eq("resume_parse_state", "needs_review")

  if (error) {
    console.error("load failed:", error.message)
    return
  }
  console.log(`candidates needing review: ${cands.length}`)

  let queued = 0
  for (const c of cands) {
    // Use .limit(1) rather than .maybeSingle() — a candidate can have more
    // than one active job (the unique index is on candidate+file, not
    // candidate alone), and maybeSingle() throws on multiple rows.
    const { data: existing } = await supabase
      .from("resume_parse_jobs")
      .select("id")
      .eq("candidate_id", c.id)
      .in("status", ["queued", "processing"])
      .limit(1)

    if (existing && existing.length) {
      queued++
      continue
    }

    const { data: fileRow } = await supabase
      .from("file_storage")
      .select("id,original_path")
      .eq("candidate_id", c.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!fileRow) {
      console.log(`  x ${c.id.slice(0, 8)} — no file in storage`)
      continue
    }

    if (dryRun) {
      queued++
      console.log(`  · ${c.id.slice(0, 8)} — would re-queue`)
      continue
    }

    const { data: job } = await supabase
      .from("parsing_jobs")
      .insert({
        candidate_id: c.id,
        file_id: fileRow.id,
        status: "pending",
        parsing_method: GEMINI_KEY ? "gemini" : "basic",
        created_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle()

    if (!job) continue

    const { error: qErr } = await supabase.from("resume_parse_jobs").insert({
      candidate_id: c.id,
      parsing_job_id: job.id,
      file_id: fileRow.id,
      file_path: fileRow.original_path,
      status: "queued",
      attempts: 0,
      next_run_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    if (qErr) {
      // The partial unique index (candidate_id, file_id) WHERE status is
      // active is the real guard — a duplicate means another run got there
      // first, which is fine.
      if (/duplicate key/i.test(qErr.message || "")) {
        queued++
      } else {
        console.log(`  x ${c.id.slice(0, 8)} — ${qErr.message}`)
      }
    } else queued++
  }
  console.log(`re-queued ${queued} candidates for a retry`)
}

async function status() {
  const { count: total } = await supabase.from("candidates").select("id", { count: "exact", head: true })
  const { count: noEmb } = await supabase.from("candidates").select("id", { count: "exact", head: true }).is("embedding", null)
  // count:"exact" with head:true — a plain select would silently cap at
  // 1000 rows and under-report.
  const { count: parsed } = await supabase
    .from("candidates").select("id", { count: "exact", head: true }).eq("resume_parse_state", "parsed")
  const { count: needsReview } = await supabase
    .from("candidates").select("id", { count: "exact", head: true }).eq("resume_parse_state", "needs_review")
  const { count: noneState } = await supabase
    .from("candidates").select("id", { count: "exact", head: true }).eq("resume_parse_state", "none")
  const { data: jobs } = await supabase.from("resume_parse_jobs").select("status")
  const jobCounts = {}
  for (const j of jobs || []) jobCounts[j.status] = (jobCounts[j.status] || 0) + 1

  console.log(`candidates: ${total}`)
  console.log(`  missing embedding: ${noEmb}`)
  console.log(`  parse state: parsed ${parsed}, needs_review ${needsReview}, none ${noneState}`)
  console.log(`queue:`, jobCounts)
}

async function main() {
  console.log(`GatiHire resume backfill${dryRun ? " (DRY RUN)" : ""} — limit ${LIMIT}`)
  await status()
  if (wants("--embeddings")) await backfillEmbeddings()
  if (wants("--stale")) await markStaleJobs()
  if (wants("--requeue")) await requeueNeedsReview()
  if (!wants("--embeddings") && !wants("--stale") && !wants("--requeue")) {
    console.log("\nNothing to do. Pass --embeddings, --stale, --requeue, or --all.")
  }
  await status()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
