create table if not exists hidden_oracle_challenges (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references wallets(id) on delete cascade,
  stellar_address text not null,
  nonce text not null,
  fingerprint text not null,
  fingerprint_field text not null,
  salt_field text not null,
  derive_tx_hash text not null,
  derive_explorer_url text not null,
  proof_nullifier text,
  used_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_hidden_oracle_challenges_wallet
  on hidden_oracle_challenges (wallet_id, created_at desc);

create index if not exists idx_hidden_oracle_challenges_expiry
  on hidden_oracle_challenges (expires_at);
