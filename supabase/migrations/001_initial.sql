-- Oracle Hunt database schema

-- Wallet registry: maps email to Stellar C-address
CREATE TABLE wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  stellar_address TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every paid Oracle consultation
CREATE TABLE consultations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id    UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  oracle_id    TEXT NOT NULL CHECK (oracle_id IN ('seer','painter','composer','scribe','scholar','informant','hidden')),
  prompt       TEXT NOT NULL,
  artifact_text TEXT NOT NULL,
  tx_hash      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX consultations_wallet_id_idx ON consultations(wallet_id);
CREATE INDEX consultations_oracle_id_idx ON consultations(oracle_id);

-- Peer votes: one vote per voter per target Codex
CREATE TABLE votes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_wallet_id  UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  target_wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_vote CHECK (voter_wallet_id != target_wallet_id),
  CONSTRAINT one_vote_per_pair UNIQUE (voter_wallet_id, target_wallet_id)
);

-- Admin reveal: maps wallet address to display name (set once, irreversible)
CREATE TABLE reveal_mapping (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  display_name   TEXT NOT NULL,
  revealed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- View: Codex completion status per wallet (5+ unique Oracles = complete)
CREATE VIEW codex_completion AS
SELECT
  w.id           AS wallet_id,
  w.stellar_address,
  w.email,
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
GROUP BY w.id, w.stellar_address, w.email;

-- View: leaderboard by completion count
CREATE VIEW leaderboard AS
SELECT
  cc.wallet_id,
  cc.stellar_address,
  rm.display_name,
  cc.oracles_consulted,
  cc.is_complete,
  cc.completed_at,
  COALESCE(v.vote_count, 0) AS vote_count
FROM codex_completion cc
LEFT JOIN reveal_mapping rm ON rm.wallet_address = cc.stellar_address
LEFT JOIN (
  SELECT target_wallet_id, COUNT(*) AS vote_count FROM votes GROUP BY target_wallet_id
) v ON v.target_wallet_id = cc.wallet_id
ORDER BY cc.oracles_consulted DESC, cc.completed_at ASC NULLS LAST;

-- Enable realtime for live leaderboard and gallery
ALTER PUBLICATION supabase_realtime ADD TABLE consultations;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;

-- Row-level security
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reveal_mapping ENABLE ROW LEVEL SECURITY;

-- Public read access to consultations (for gallery)
CREATE POLICY "consultations_public_read" ON consultations FOR SELECT USING (true);
-- Public read access to votes
CREATE POLICY "votes_public_read" ON votes FOR SELECT USING (true);
-- Public read access to wallets (address only, no email)
CREATE POLICY "wallets_public_read" ON wallets FOR SELECT USING (true);
-- reveal_mapping is public read (names only shown after reveal)
CREATE POLICY "reveal_public_read" ON reveal_mapping FOR SELECT USING (true);

-- Service role (workers backend) can insert/update all tables
-- These are enforced by using SUPABASE_SERVICE_KEY server-side only
