# Oracle Hunt

Oracle Hunt is a passkey-first Stellar game built as a monorepo. Users enter the Midnight Midway, create or reconnect a Stellar smart wallet, pay testnet USDC through x402-gated oracle endpoints, collect artifacts in a personal Codex, and unlock a Hidden Oracle that uses client-side zero-knowledge proof generation plus Soroban verification.

This repo currently targets Stellar testnet in local/dev worker config.

## Repo Map

- [`apps/web`](./apps/web/README.md): Next.js frontend, Midnight Midway experience, browser wallet flow, gallery, leaderboard, Codex, Hidden Oracle client proof generation.
- [`apps/workers`](./apps/workers/README.md): Cloudflare Worker API, x402 middleware, public oracle handlers, Composer/MiniMax orchestration, Hidden Oracle verification flow, faucet.
- [`supabase`](./supabase/README.md): schema and migrations for wallets, consultations, votes, composer sessions, views.
- [`packages/contracts`](./packages/contracts/README.md): Soroban fingerprint contract.
- [`packages/hidden-oracle-zk`](./packages/hidden-oracle-zk/README.md): Circom circuit and Groth16 artifact generation.
- [`packages/hidden-oracle-verifier`](./packages/hidden-oracle-verifier/README.md): Soroban verifier contract for the Hidden Oracle proof.
- [`scripts`](./scripts): repo utilities, including the Stellar SDK layout shim used after install.

## User Navigation

Primary frontend routes:

- `/`: passkey login / wallet creation / username onboarding
- `/midway`: primary oracle hub and progress surface
- `/marketplace`: compatibility redirect to `/midway`
- `/oracle/[id]`: Seer, Painter, Composer, Scribe, Stella, Informant
- `/oracle/hidden`: Hidden Oracle unlock and proof flow
- `/codex/[wallet]`: one wallet's artifact collection
- `/gallery`: all public artifacts and Codex cards
- `/leaderboard`: Seekers / Agentic Economy ranked boards
- `/how-it-works`: nontechnical and technical explanation of the game flow

Current product rules:

- Public identity is the wallet username.
- There is no active admin reveal flow anymore.
- Progress counts only the five core oracles:
  - `seer`
  - `painter`
  - `composer`
  - `scribe`
  - `scholar`
- `informant` and `hidden` still save to Codex and Gallery, but do not count toward progress completion.
- Gallery votes target individual artifacts. Seeker vote totals are the sum of votes across that seeker's artifacts.

## High-Level Architecture

### 1. Web app

The Next app owns:

- passkey wallet onboarding and reconnect
- x402 client-side payment signing
- Midnight Midway routing and artifact rendering
- local Hidden Oracle proof generation in the browser
- server-side helper routes for wallet registration, votes, faucet proxying, and Hidden Oracle proxying

### 2. Worker backend

The Cloudflare Worker owns:

- x402 payment verification for public oracle endpoints
- oracle execution against Gemini, Stella, or Cloudflare/Composer music generation
- persistence into Supabase using the service key
- Hidden Oracle challenge issuance and proof verification on Soroban
- testnet faucet funding for new wallets

### 3. Supabase

Supabase stores:

- wallet registry
- consultation history
- Codex/gallery/leaderboard source data
- votes
- Composer async session state
- Hidden Oracle challenge state

### 4. On-chain

Stellar is used for:

- USDC oracle payments
- treasury-sponsored fee payment / relaying
- wallet fingerprint derivation on Soroban
- Hidden Oracle proof verification on Soroban

## Core Flows

### Public oracle flow

1. User opens `/oracle/[id]`.
2. Frontend sends a request to the worker.
3. Worker responds through x402 middleware with payment requirements.
4. Browser signs the USDC payment with the passkey wallet.
5. Worker verifies the payment.
6. Worker calls Gemini, Stella, or the Composer music flow depending on the oracle.
7. Worker writes the consultation to Supabase.
8. Frontend renders the artifact and execution trace.

### Hidden Oracle flow

1. User discovers the phrase through Informant responses.
2. Frontend requests a one-time challenge from the worker.
3. Worker derives a wallet-bound fingerprint on Soroban and returns the challenge context.
4. Browser generates a Groth16 proof locally using the phrase and wallet-bound context.
5. Worker relays proof verification to the Soroban verifier contract.
6. If valid, worker creates the Hidden Oracle artifact and saves it to Supabase.

### Composer flow

1. User pays for the Composer through x402 like any other public oracle.
2. Worker creates a queued Composer session and enqueues one music generation job.
3. Worker returns `pending`, and the page polls the session id.
4. The queue consumer saves the generated song URL.
5. On completion, one audio URL is persisted to Supabase and rendered like a normal artifact.

## Current Runtime Identifiers

These are the current public testnet identifiers used by local/dev worker config.

| Item | Value | Notes |
|--|--|--|
| Stellar network | `testnet` | Worker `wrangler.toml` default |
| Treasury / relayer address | `GDYKSKSCR5XABKFVRI3CTB2FFRWZB5PDFOXXCROX2POVY4KBO5KJGGLB` | receives USDC oracle payments and sponsors fee-bearing txs |
| USDC contract | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | SAC used for oracle payments |
| Fingerprint contract | `CCA6GIF5G75DLCTJNAWZQAFRATPE46PNSRQVXB2GZKNHBPKOXDTM3DUB` | `packages/contracts` deployment |
| Hidden Oracle verifier contract | `CBWXMIRUF3SG2LRB52IQYSH3UYGHY3QJ5KOEMYXEPJ4TN5VSTCAJ7LQI` | `packages/hidden-oracle-verifier` deployment |
| Composer model | `minimax/music-2.6` | Cloudflare Workers AI binding configured in Worker env |

## Important Implementation Notes

### Hidden phrase changes are not just env changes

The Hidden Oracle phrase is baked into the generated Groth16 artifacts. The current artifact build defaults to `LIQUIDITY`.

That means changing the phrase requires:

1. updating the intended phrase
2. rebuilding the ZK artifacts in [`packages/hidden-oracle-zk`](./packages/hidden-oracle-zk/README.md)
3. regenerating the verifier contract constants
4. rebuilding/redeploying the verifier contract
5. updating worker/web runtime config if needed

Changing only `INFORMANT_PASSPHRASE` is not enough anymore.

### No active admin system

The earlier admin reveal flow has been removed from the app. The historical `reveal_mapping` table still exists in migrations, but no web route uses it anymore.

### Recovery UI is intentionally hidden

There is still a server-assisted wallet lookup path in the codebase, but the login page no longer exposes a recovery form. The visible login flow is now:

- connect existing passkey wallet
- create new wallet
- reconnect a recent wallet stored on this device

### Postinstall shim

The repo runs [`scripts/fix-stellar-sdk-layout.mjs`](./scripts/fix-stellar-sdk-layout.mjs) after install. This writes a missing `lib/package.json` shim for `@stellar/stellar-sdk` so Next + passkey-kit compile reliably.

## Local Development

Install once:

```bash
pnpm install
```

Run everything through Turborepo:

```bash
pnpm dev
```

Or run stacks separately:

```bash
pnpm --filter @oraclehunt/web dev
pnpm --filter @oraclehunt/workers dev
```

Useful checks:

```bash
pnpm --filter @oraclehunt/web typecheck
pnpm --filter @oraclehunt/workers typecheck
pnpm --filter @oraclehunt/workers test
cargo test --manifest-path packages/contracts/Cargo.toml
cargo build --target wasm32v1-none --release --manifest-path packages/contracts/Cargo.toml
supabase db push --yes
```

## Where To Start

If you are new to the repo:

1. Read [`apps/web/README.md`](./apps/web/README.md) for user flow and page navigation.
2. Read [`apps/workers/README.md`](./apps/workers/README.md) for backend routes and oracle execution.
3. Read [`supabase/README.md`](./supabase/README.md) for schema and view semantics.
4. Read the ZK package READMEs if you need to modify the Hidden Oracle proof system.
