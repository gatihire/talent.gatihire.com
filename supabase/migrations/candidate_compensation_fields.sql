-- Candidate compensation / availability fields captured at apply time
-- (ApplyStepper: Current CTC, Expected CTC, Notice period, Reason for switching).
-- Added ALTER IF NOT EXISTS so it is safe to run on the shared Supabase project.
-- Run in the Supabase SQL editor once.

alter table public.candidates
  add column if not exists current_ctc text,
  add column if not exists expected_ctc text,
  add column if not exists notice_period text,
  add column if not exists reason_for_switching text,
  add column if not exists current_salary text,
  add column if not exists expected_salary text;

-- Refresh PostgREST schema cache so the new columns are immediately queryable.
notify pgrst, 'reload schema';