DROP FUNCTION IF EXISTS claim_resume_parse_jobs(TEXT, INT);

CREATE OR REPLACE FUNCTION claim_resume_parse_jobs(batch_size INT, worker_id TEXT)
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

REVOKE ALL ON FUNCTION claim_resume_parse_jobs(INT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION claim_resume_parse_jobs(INT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION claim_resume_parse_jobs(INT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

