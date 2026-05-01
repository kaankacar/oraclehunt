ALTER TABLE composer_sessions
  DROP CONSTRAINT IF EXISTS composer_sessions_status_check;

ALTER TABLE composer_sessions
  ALTER COLUMN status SET DEFAULT 'awaiting_auth',
  ADD CONSTRAINT composer_sessions_status_check
    CHECK (status IN ('awaiting_auth', 'queued', 'processing', 'complete', 'error'));
