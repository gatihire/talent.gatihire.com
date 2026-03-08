CREATE TABLE IF NOT EXISTS resume_parse_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL,
  parsing_job_id UUID NOT NULL,
  file_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','succeeded','failed')),
  attempts INT NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  next_run_at TIMESTAMPTZ NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resume_parse_jobs_status_created_at ON resume_parse_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_resume_parse_jobs_candidate_id ON resume_parse_jobs(candidate_id);
CREATE INDEX IF NOT EXISTS idx_resume_parse_jobs_parsing_job_id ON resume_parse_jobs(parsing_job_id);
CREATE INDEX IF NOT EXISTS idx_resume_parse_jobs_next_run_at ON resume_parse_jobs(next_run_at);

ALTER TABLE resume_parse_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE resume_parse_jobs FROM anon;
REVOKE ALL ON TABLE resume_parse_jobs FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE resume_parse_jobs TO service_role;

CREATE OR REPLACE FUNCTION claim_resume_parse_jobs(worker_id TEXT, batch_size INT)
RETURNS SETOF resume_parse_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM resume_parse_jobs
    WHERE status = 'queued'
      AND (next_run_at IS NULL OR next_run_at <= now())
    ORDER BY created_at ASC
    LIMIT GREATEST(1, LEAST(batch_size, 50))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE resume_parse_jobs r
  SET status = 'processing',
      locked_at = now(),
      locked_by = worker_id,
      attempts = r.attempts + 1,
      updated_at = now(),
      error = NULL
  FROM picked
  WHERE r.id = picked.id
  RETURNING r.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_resume_parse_jobs(TEXT, INT) FROM anon;
REVOKE ALL ON FUNCTION claim_resume_parse_jobs(TEXT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION claim_resume_parse_jobs(TEXT, INT) TO service_role;

