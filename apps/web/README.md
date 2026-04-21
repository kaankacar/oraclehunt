# Web App Guide

This app is the user-facing Next.js frontend for Oracle Hunt.

It owns:

- passkey-first login and wallet creation
- username onboarding
- x402 payment initiation from the browser
- Codex, Gallery, Leaderboard, and Marketplace pages
- Hidden Oracle proof generation in the browser
- server-side proxy routes for wallet registration, votes, faucet, Hidden Oracle, and Smol auth

## Folder Map

- `src/app/page.tsx`: landing page and login flow
- `src/app/marketplace/page.tsx`: oracle catalog and progress
- `src/app/oracle/[id]/page.tsx`: public oracle interaction page
- `src/app/oracle/hidden/page.tsx`: Hidden Oracle UI
- `src/app/codex/[wallet]/page.tsx`: one wallet's Codex
- `src/app/gallery/page.tsx`: public artifact feed + Codex cards
- `src/app/leaderboard/page.tsx`: single leaderboard
- `src/components/WalletProvider.tsx`: wallet/session state
- `src/components/ArtifactCard.tsx`: artifact rendering
- `src/components/TraceTimeline.tsx`: execution trace UI
- `src/lib/wallet.ts`: passkey-kit integration, x402 signing, balance fetching
- `src/lib/oracle-api.ts`: public oracle + Composer client calls
- `src/lib/hidden-oracle-api.ts`: Hidden Oracle client flow
- `src/lib/hidden-oracle-zk.ts`: browser proof generation
- `src/lib/supabase.ts`: public data reads and vote helper

## User-Facing Routes

### `/`

The landing page does three things:

- connect an existing passkey wallet
- create a new passkey wallet
- reconnect a recently used wallet remembered on this device

Current UI choice:

- the identifier-based recovery flow is still implemented in `WalletProvider`, but it is intentionally not shown on the page anymore

### `/marketplace`

Shows:

- six public oracles
- current fees
- core-oracle progress
- the Hidden Oracle teaser card

### `/oracle/[id]`

Shared public-oracle page for:

- `seer`
- `painter`
- `composer`
- `scribe`
- `scholar`
- `informant`

Notes:

- all public oracles pay through x402
- Composer may enter a second Smol-auth step and then poll asynchronously
- Informant shows previous Informant answers for the current wallet

### `/oracle/hidden`

The Hidden Oracle page:

- asks for the discovered phrase
- requests a challenge from the worker
- generates a Groth16 proof in the browser
- submits the proof to the Next helper route
- renders the fingerprint, portrait, and full trace

### `/codex/[wallet]`

Shows all consultations for one wallet address:

- full artifact text
- images
- Composer audio URLs when present
- execution trace
- core-oracle completion status

### `/gallery`

Two public views:

- artifact feed
- Codex cards

Voting happens here, not on the leaderboard.

### `/leaderboard`

A single ranked board. It uses:

- core-oracle progress
- then votes
- then earliest completion

Usernames are public and visible here from the start.

## Next.js API Routes

- `POST /api/wallet/lookup`: server-side wallet lookup
- `POST /api/wallet/register`: server-side username registration
- `POST /api/votes`: server-side vote insertion
- `POST /api/faucet`: proxy to the worker faucet
- `POST /api/hidden-oracle/challenge`: proxy to worker challenge issuance
- `POST /api/hidden-oracle/consult`: proxy to worker Hidden Oracle verification
- `POST /api/smol/auth`: exchanges a passkey assertion for a Smol JWT and stores it in Supabase

## Wallet and Login Model

The app is passkey-first.

Public identity:

- `username`

Durable wallet identity:

- Stellar contract account address
- WebAuthn credential id (`key_id_base64`)

High-level flow:

1. connect or create wallet
2. look up wallet on the server
3. if the wallet has no username, prompt for one
4. save the session locally
5. poll USDC balance

Important current behavior:

- sign-out clears the active session but keeps the recent-wallet registry
- new testnet wallets may be auto-seeded from the treasury

## Public Oracle Payment Flow

The frontend uses `@x402/fetch` plus a custom passkey-backed Stellar payment scheme.

Owned in:

- `src/lib/wallet.ts`
- `src/lib/oracle-api.ts`

Flow:

1. browser hits worker oracle route
2. worker responds with payment requirements
3. browser simulates the USDC transfer
4. browser signs with the passkey wallet
5. browser re-simulates to get correct Soroban fees
6. browser retries with payment headers

The UI trace events are driven from this flow.

## Hidden Oracle Client Flow

Owned in:

- `src/lib/hidden-oracle-api.ts`
- `src/lib/hidden-oracle-zk.ts`

Browser responsibilities:

- normalize wallet address and phrase into field elements
- load `snarkjs` lazily
- generate the Groth16 proof locally
- never send the raw phrase to the worker as plain application input

Assets loaded from public files:

- `/zk/hidden_oracle.wasm`
- `/zk/hidden_oracle_final.zkey`

## Composer-Specific Frontend Flow

Composer is the only public oracle that is async.

Owned in:

- `src/lib/oracle-api.ts`
- `src/app/oracle/[id]/page.tsx`
- `src/app/api/smol/auth/route.ts`

Extra behavior:

- may require one additional passkey assertion for Smol
- receives `pending` instead of an immediate artifact
- polls worker status until complete
- renders cover art, lyrics, and two audio variations

## Styling

Color system is centralized in:

- `src/app/globals.css`
- `tailwind.config.ts`

Current palette direction is intentionally closer to `stellar.org`:

- warm light surfaces
- deep ink text
- soft lilac accents

## Environment Variables

See `.env.example`.

Main ones:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `NEXT_PUBLIC_WORKERS_URL`
- `NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH`
- `NEXT_PUBLIC_STELLAR_NETWORK`
- `NEXT_PUBLIC_OZ_RELAYER_URL`
- `NEXT_PUBLIC_OZ_RELAYER_API_KEY`

## Local Development

```bash
pnpm --filter @oraclehunt/web dev
pnpm --filter @oraclehunt/web typecheck
```

If `3000` is occupied, run Next on a different port manually.

## Repo-Specific Caveat

This app depends on the root postinstall shim in `scripts/fix-stellar-sdk-layout.mjs`. If you see build errors around `@stellar/stellar-sdk/lib/package.json`, rerun:

```bash
pnpm install
```
