# Supabase Guide

This folder owns the data model for Oracle Hunt.

## What Supabase Stores

Main tables:

- `wallets`
- `consultations`
- `votes`
- `composer_sessions`
- `hidden_oracle_challenges`

Legacy table:

- `reveal_mapping`

The legacy reveal table still exists in migration history, but the current app no longer exposes an admin reveal flow.

## Migration Order

- `001_initial.sql`: initial schema
- `002_wallet_key_ids.sql`: passkey credential id support
- `003_consultation_traces_and_zk.sql`: trace + image + ZK fields
- `004_wallet_usernames.sql`: public username model
- `005_hidden_oracle_challenges.sql`: one-time challenge persistence
- `006_core_oracle_progress.sql`: core-oracle progress views
- `007_composer_smol.sql`: Smol JWT, composer sessions, audio fields
- `008_fix_composer_smol_job_index.sql`: full unique index for `smol_job_id`

## Current Table Semantics

### `wallets`

Holds the public wallet registry.

Current important columns:

- `stellar_address`
- `username`
- `key_id_base64`
- `smol_jwt`
- `smol_jwt_expires_at`

Historical note:

- the schema started email-first
- current product is username-first
- `email` is now legacy and no longer required

### `consultations`

One row per saved oracle result.

Important columns:

- `wallet_id`
- `oracle_id`
- `prompt`
- `artifact_text`
- `artifact_image`
- `audio_url_1`
- `audio_url_2`
- `smol_job_id`
- `tx_hash`
- `processing_trace`
- `fingerprint`
- `zk_contract_id`
- `zk_tx_hash`
- `zk_verify_tx_hash`

### `votes`

One vote per voter-wallet to target-wallet pair.

Important constraints:

- no self-vote
- one vote per pair

### `composer_sessions`

Tracks the async Composer flow before the final consultation row exists.

Important columns:

- `stellar_address`
- `tx_hash`
- `prompt`
- `smol_job_id`
- `status`
- `error_message`

### `hidden_oracle_challenges`

Created by `005_hidden_oracle_challenges.sql`.

Used to persist one-time Hidden Oracle proof context and anti-replay state.

## Views Used By the App

### `wallet_profiles_public`

Minimal public wallet projection used by the frontend.

### `codex_completion`

Current progress semantics:

- counts only core oracle ids
- `seer`, `painter`, `composer`, `scribe`, `scholar`

### `leaderboard`

Historical view kept in the database. The frontend now computes the leaderboard directly from public tables for its current ranking behavior.

### `gallery_artifacts`

Artifact feed view used by the Gallery page.

Includes:

- artifact fields
- wallet address
- display name
- vote count

## Security Model

Public reads are intentionally limited:

- consultations
- votes
- wallet public view
- gallery/leaderboard related views

Server-side writes happen through:

- the worker service key
- Next.js server routes using the service key where needed

## Current Product Notes

- There is no active admin reveal feature anymore.
- Usernames are public from the start.
- Core-oracle progress is the metric that matters for completion.
- Composer artifacts add image and audio fields beyond the original consultation model.

## Typical Command

```bash
supabase db push --yes
```
