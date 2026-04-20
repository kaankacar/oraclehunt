ALTER TABLE wallets
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS wallets_username_key
  ON wallets (username)
  WHERE username IS NOT NULL;

CREATE OR REPLACE VIEW wallet_profiles_public AS
SELECT
  id,
  stellar_address,
  username
FROM wallets;

GRANT SELECT ON wallet_profiles_public TO anon, authenticated;

DROP POLICY IF EXISTS "wallets_public_read" ON wallets;

DROP VIEW IF EXISTS leaderboard;
DROP VIEW IF EXISTS gallery_artifacts;
DROP VIEW IF EXISTS codex_completion;

CREATE OR REPLACE VIEW codex_completion AS
SELECT
  w.id AS wallet_id,
  w.stellar_address,
  w.username,
  COUNT(DISTINCT c.oracle_id) AS oracles_consulted,
  COUNT(DISTINCT c.oracle_id) >= 5 AS is_complete,
  MIN(c.created_at) FILTER (WHERE sub.rank = 1) AS completed_at
FROM wallets w
LEFT JOIN consultations c ON c.wallet_id = w.id
LEFT JOIN (
  SELECT wallet_id, oracle_id, ROW_NUMBER() OVER (
    PARTITION BY wallet_id ORDER BY created_at
  ) AS rank
  FROM (
    SELECT wallet_id, oracle_id, created_at,
           ROW_NUMBER() OVER (PARTITION BY wallet_id, oracle_id ORDER BY created_at) AS rn
    FROM consultations
  ) deduped
  WHERE rn = 1
) sub ON sub.wallet_id = c.wallet_id AND sub.oracle_id = c.oracle_id
GROUP BY w.id, w.stellar_address, w.username;

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
ORDER BY cc.oracles_consulted DESC, cc.completed_at ASC NULLS LAST;

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
