ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS payment_amount_usdc NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS estimated_model_cost_usdc NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS estimated_profit_usdc NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS oracle_wallet_address TEXT,
  ADD COLUMN IF NOT EXISTS ai_provider TEXT,
  ADD COLUMN IF NOT EXISTS ai_model TEXT,
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS total_tokens INTEGER;

CREATE OR REPLACE VIEW gallery_artifacts AS
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
  COALESCE(v.vote_count, 0) AS vote_count,
  c.payment_amount_usdc,
  c.estimated_model_cost_usdc,
  c.estimated_profit_usdc,
  c.oracle_wallet_address,
  c.ai_provider,
  c.ai_model,
  c.input_tokens,
  c.output_tokens,
  c.total_tokens
FROM consultations c
JOIN wallets w ON w.id = c.wallet_id
LEFT JOIN reveal_mapping rm ON rm.wallet_address = w.stellar_address
LEFT JOIN (
  SELECT target_wallet_id, COUNT(*) AS vote_count
  FROM votes
  GROUP BY target_wallet_id
) v ON v.target_wallet_id = c.wallet_id
ORDER BY c.created_at DESC;

CREATE OR REPLACE VIEW agentic_economy AS
SELECT
  c.oracle_id,
  COUNT(*)::INTEGER AS consultations,
  COALESCE(SUM(c.payment_amount_usdc), 0)::NUMERIC(12, 6) AS gross_revenue_usdc,
  COALESCE(SUM(c.estimated_model_cost_usdc), 0)::NUMERIC(12, 6) AS estimated_model_cost_usdc,
  COALESCE(SUM(c.estimated_profit_usdc), 0)::NUMERIC(12, 6) AS estimated_profit_usdc,
  MAX(c.oracle_wallet_address) AS oracle_wallet_address
FROM consultations c
WHERE c.oracle_id IN ('seer', 'painter', 'composer', 'scribe', 'scholar', 'informant')
GROUP BY c.oracle_id;
