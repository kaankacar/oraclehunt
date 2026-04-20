ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS artifact_image TEXT,
  ADD COLUMN IF NOT EXISTS processing_trace JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS zk_contract_id TEXT,
  ADD COLUMN IF NOT EXISTS zk_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS zk_verify_tx_hash TEXT;

CREATE INDEX IF NOT EXISTS consultations_created_at_idx ON consultations(created_at DESC);

CREATE OR REPLACE VIEW gallery_artifacts AS
SELECT
  c.id,
  c.wallet_id,
  c.oracle_id,
  c.prompt,
  c.artifact_text,
  c.artifact_image,
  c.tx_hash,
  c.processing_trace,
  c.fingerprint,
  c.zk_contract_id,
  c.zk_tx_hash,
  c.zk_verify_tx_hash,
  c.created_at,
  w.stellar_address,
  rm.display_name,
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
