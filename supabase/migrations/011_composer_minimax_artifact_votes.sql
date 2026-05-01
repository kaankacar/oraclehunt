ALTER TABLE composer_sessions
  DROP CONSTRAINT IF EXISTS composer_sessions_status_check;

UPDATE composer_sessions
SET status = 'queued'
WHERE status = 'awaiting_auth';

ALTER TABLE composer_sessions
  ALTER COLUMN status SET DEFAULT 'queued',
  ADD CONSTRAINT composer_sessions_status_check
    CHECK (status IN ('queued', 'processing', 'complete', 'error'));

ALTER TABLE composer_sessions
  ADD COLUMN IF NOT EXISTS payment_amount_usdc NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS estimated_model_cost_usdc NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS estimated_profit_usdc NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS oracle_wallet_address TEXT,
  ADD COLUMN IF NOT EXISTS ai_provider TEXT,
  ADD COLUMN IF NOT EXISTS ai_model TEXT;

ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS composer_session_id UUID REFERENCES composer_sessions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS consultations_composer_session_id_key
  ON consultations (composer_session_id)
  WHERE composer_session_id IS NOT NULL;

ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS target_consultation_id UUID REFERENCES consultations(id) ON DELETE CASCADE;

ALTER TABLE votes
  DROP CONSTRAINT IF EXISTS one_vote_per_pair;

CREATE UNIQUE INDEX IF NOT EXISTS votes_one_per_consultation
  ON votes (voter_wallet_id, target_consultation_id)
  WHERE target_consultation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_self_artifact_vote()
RETURNS TRIGGER AS $$
DECLARE
  owner_wallet_id UUID;
BEGIN
  IF NEW.target_consultation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT wallet_id INTO owner_wallet_id
  FROM consultations
  WHERE id = NEW.target_consultation_id;

  IF owner_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Target consultation not found';
  END IF;

  IF owner_wallet_id = NEW.voter_wallet_id THEN
    RAISE EXCEPTION 'You cannot vote for your own artifact';
  END IF;

  NEW.target_wallet_id = owner_wallet_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS votes_prevent_self_artifact_vote ON votes;
CREATE TRIGGER votes_prevent_self_artifact_vote
BEFORE INSERT OR UPDATE OF voter_wallet_id, target_consultation_id
ON votes
FOR EACH ROW
EXECUTE FUNCTION prevent_self_artifact_vote();

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
  c.payment_amount_usdc,
  c.estimated_model_cost_usdc,
  c.estimated_profit_usdc,
  c.oracle_wallet_address,
  c.ai_provider,
  c.ai_model,
  c.input_tokens,
  c.output_tokens,
  c.total_tokens,
  c.created_at,
  w.stellar_address,
  COALESCE(rm.display_name, w.username) AS display_name,
  COALESCE(v.vote_count, 0) AS vote_count
FROM consultations c
JOIN wallets w ON w.id = c.wallet_id
LEFT JOIN reveal_mapping rm ON rm.wallet_address = w.stellar_address
LEFT JOIN (
  SELECT target_consultation_id, COUNT(*) AS vote_count
  FROM votes
  WHERE target_consultation_id IS NOT NULL
  GROUP BY target_consultation_id
) v ON v.target_consultation_id = c.id
ORDER BY c.created_at DESC;

CREATE OR REPLACE VIEW leaderboard AS
SELECT
  cc.wallet_id,
  cc.stellar_address,
  COALESCE(rm.display_name, cc.username) AS display_name,
  cc.oracles_consulted,
  cc.is_complete,
  cc.completed_at,
  COALESCE(v.vote_count, 0) AS vote_count
FROM codex_completion cc
LEFT JOIN reveal_mapping rm ON rm.wallet_address = cc.stellar_address
LEFT JOIN (
  SELECT target_wallet_id, COUNT(*) AS vote_count
  FROM votes
  GROUP BY target_wallet_id
) v ON v.target_wallet_id = cc.wallet_id
ORDER BY cc.oracles_consulted DESC, cc.completed_at ASC NULLS LAST, COALESCE(v.vote_count, 0) DESC;
