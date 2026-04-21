ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS smol_jwt TEXT,
  ADD COLUMN IF NOT EXISTS smol_jwt_expires_at TIMESTAMPTZ;

ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS audio_url_1 TEXT,
  ADD COLUMN IF NOT EXISTS audio_url_2 TEXT,
  ADD COLUMN IF NOT EXISTS smol_job_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS consultations_smol_job_id_key
  ON consultations (smol_job_id)
  WHERE smol_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS composer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  stellar_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  prompt TEXT NOT NULL,
  smol_job_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'awaiting_auth'
    CHECK (status IN ('awaiting_auth', 'queued', 'complete', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS composer_sessions_wallet_created_idx
  ON composer_sessions (wallet_id, created_at DESC);

DROP VIEW IF EXISTS gallery_artifacts;

CREATE VIEW gallery_artifacts AS
SELECT
  c.id,
  c.wallet_id,
  c.oracle_id,
  c.prompt,
  c.artifact_text,
  c.artifact_image,
  c.audio_url_1,
  c.audio_url_2,
  c.smol_job_id,
  c.tx_hash,
  c.processing_trace,
  c.fingerprint,
  c.zk_contract_id,
  c.zk_tx_hash,
  c.zk_verify_tx_hash,
  c.created_at,
  w.stellar_address,
  COALESCE(rm.display_name, w.username) AS display_name,
  COALESCE(v.vote_count, 0) AS vote_count
FROM consultations c
JOIN wallets w ON w.id = c.wallet_id
LEFT JOIN reveal_mapping rm ON rm.wallet_address = w.stellar_address
LEFT JOIN (
  SELECT target_wallet_id, COUNT(*) AS vote_count
  FROM votes
  GROUP BY target_wallet_id
) v ON v.target_wallet_id = c.wallet_id
ORDER BY c.created_at DESC;
