CREATE OR REPLACE VIEW codex_completion AS
WITH unique_progress_consultations AS (
  SELECT
    c.wallet_id,
    c.oracle_id,
    MIN(c.created_at) AS first_seen_at
  FROM consultations c
  WHERE c.oracle_id IN ('seer', 'painter', 'composer', 'scribe', 'scholar')
  GROUP BY c.wallet_id, c.oracle_id
),
ranked_progress AS (
  SELECT
    up.wallet_id,
    up.oracle_id,
    up.first_seen_at,
    ROW_NUMBER() OVER (
      PARTITION BY up.wallet_id
      ORDER BY up.first_seen_at, up.oracle_id
    ) AS progress_rank
  FROM unique_progress_consultations up
)
SELECT
  w.id AS wallet_id,
  w.stellar_address,
  w.username,
  COUNT(rp.oracle_id) AS oracles_consulted,
  COUNT(rp.oracle_id) >= 5 AS is_complete,
  MIN(rp.first_seen_at) FILTER (WHERE rp.progress_rank = 5) AS completed_at
FROM wallets w
LEFT JOIN ranked_progress rp ON rp.wallet_id = w.id
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
