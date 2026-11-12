-- Resume parse lifecycle on the candidate row.
--
-- Before this, a candidate whose resume could not be parsed was
-- indistinguishable from a candidate who never uploaded one: both had
-- resume_text = NULL. Recruiters saw an "empty import" with no way to tell
-- that a file was sitting there waiting to be read.
--
-- This gives the candidate row an explicit, queryable state so that:
--   * the apply flow can say "we got your resume, we're still reading it"
--     instead of silently failing,
--   * the admin portal can list candidates whose resume needs attention,
--   * a background reaper can find and retry the stuck ones.
--
-- States:
--   none        - no resume uploaded yet
--   queued      - file uploaded, parse job enqueued, not started
--   parsing     - a worker or the API is parsing right now
--   parsed      - parsed successfully, all fields populated
--   partial     - text extracted but structured fields incomplete
--                 (scanned PDF, odd layout). resume_text IS stored.
--   needs_review- parsing failed and exhausted retries. The file and any
--                 raw text are kept; a human needs to look.

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_parse_state TEXT NOT NULL DEFAULT 'none';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_parse_error TEXT;

-- The pipeline queries "candidates whose resume is unreadable" — index it.
CREATE INDEX IF NOT EXISTS idx_candidates_resume_parse_state
  ON candidates (resume_parse_state)
  WHERE resume_parse_state IS NOT NULL AND resume_parse_state <> 'parsed';

-- Backfill existing rows from what we already know:
--   * a row with resume_text was parsed at some point
--   * a row with a file but no text failed or never ran
--   * a row with neither never uploaded anything
UPDATE candidates
SET resume_parse_state = CASE
  WHEN resume_text IS NOT NULL AND length(resume_text) > 0 THEN 'parsed'
  WHEN file_url IS NOT NULL THEN 'needs_review'
  ELSE 'none'
END
WHERE resume_parse_state = 'none';

-- Unique partial index so re-clicking "Parse existing" cannot stack up
-- duplicate queue rows for the same candidate + file. The old table had
-- only non-unique indexes, which is how 88 candidates ended up with more
-- than one queued job.
CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_parse_jobs_active_unique
  ON resume_parse_jobs (candidate_id, file_id)
  WHERE status IN ('queued', 'processing');

-- Deduplicate whatever duplicates already exist, keeping the newest.
DELETE FROM resume_parse_jobs a
USING resume_parse_jobs b
WHERE a.candidate_id = b.candidate_id
  AND a.file_id = b.file_id
  AND a.status IN ('queued', 'processing')
  AND b.status IN ('queued', 'processing')
  AND a.id < b.id;
