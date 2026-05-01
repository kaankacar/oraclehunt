# Worker Backend Guide

This app is the Cloudflare Worker backend for Oracle Hunt.

It owns:

- x402 payment gating for public oracles
- OpenAI/Stella-backed public oracle execution
- Composer orchestration with fal.ai ACE-Step
- Hidden Oracle challenge issuance and proof verification
- Supabase writes using the service key
- local/testnet faucet support

## Main Entry Point

- `src/index.ts`

This file wires:

- CORS
- global error handling
- x402 middleware
- oracle routes
- composer status routes
- Hidden Oracle routes
- health and faucet routes

## Public Worker Routes

### `POST /oracle/:id`

Public paid oracle route for:

- `seer`
- `painter`
- `composer`
- `scribe`
- `scholar`
- `informant`

Behavior:

- `x402` middleware runs first
- public oracles require `prompt` and `walletAddress`
- `composer` is special-cased and may return `202`

### `GET /oracle/composer/status/:jobId`

Free polling endpoint for Composer session status.

### `POST /oracle/hidden/challenge`

Issues a Hidden Oracle challenge after deriving the wallet fingerprint on Soroban.

### `POST /oracle/hidden`

Verifies the Hidden Oracle proof and persists the Hidden Oracle consultation.

### `POST /faucet`

Funds a wallet on testnet for local/dev use.

### `GET /health`

Simple health check.

## x402 Integration

Owned in:

- `src/middleware/payment.ts`
- `src/index.ts`

The worker uses x402 as middleware, not as a separate contract-per-oracle model.

What actually happens:

1. browser requests a public oracle endpoint
2. worker issues x402 payment requirements
3. browser signs a Stellar USDC transfer
4. worker verifies the signed payment
5. only then does the oracle handler run

Current treasury / relayer address:

- `GDYKSKSCR5XABKFVRI3CTB2FFRWZB5PDFOXXCROX2POVY4KBO5KJGGLB`

Current USDC contract:

- `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`

The treasury currently plays three roles:

- receives oracle payments
- sponsors fee-bearing transactions
- funds new testnet wallets

## Oracle Ownership

### Shared public oracles

Owned in:

- `src/oracles/handler.ts`
- `src/oracles/prompts.ts`

Behavior:

- looks up the wallet in Supabase
- calls OpenAI for Seer, Scribe, Informant, and Painter
- calls Stella directly for Stellar answers
- writes a consultation row
- emits a processing trace

### Composer

Owned in:

- `src/oracles/composer.ts`

Composer diverges from the shared path because it is async and uses fal.ai's ACE-Step music model.

Flow:

1. verify x402 payment
2. create or load a `composer_sessions` row
3. submit a fal.ai queue job for `fal-ai/ace-step/prompt-to-audio`
4. return `pending` with the Composer session id
5. poll fal.ai until the generated lyrics and hosted audio URL are ready
6. once finished, persist consultation with:
   - `audio_url_1`
   - generated lyric text
   - provider request id in the legacy `smol_job_id` column

### Hidden Oracle

Owned in:

- `src/oracles/hidden.ts`

Flow:

1. confirm wallet exists
2. derive wallet fingerprint on Soroban using the fingerprint contract
3. issue a one-time challenge
4. accept Groth16 proof + public signals from the frontend
5. verify the proof on the Soroban verifier contract
6. generate the portrait with Gemini image + text
7. persist the result to Supabase

Important:

- the user does not directly send the proof verification transaction
- the worker relays the on-chain verification through the treasury flow

## Environment Variables

See `wrangler.toml` and `.dev.vars.example`.

Important ones:

- `GEMINI_API_KEY`
- `ORACLE_TREASURY_ADDRESS`
- `ORACLE_TREASURY_SECRET`
- `USDC_CONTRACT`
- `FINGERPRINT_SALT`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ZK_CONTRACT_ID`
- `HIDDEN_ORACLE_VERIFIER_CONTRACT_ID`
- `INFORMANT_PASSPHRASE`
- `ADMIN_CORS_ORIGIN`
- `FAL_KEY`
- `WORKERS_PUBLIC_URL`

Current local/dev public IDs:

- fingerprint contract: `CCA6GIF5G75DLCTJNAWZQAFRATPE46PNSRQVXB2GZKNHBPKOXDTM3DUB`
- verifier contract: `CBWXMIRUF3SG2LRB52IQYSH3UYGHY3QJ5KOEMYXEPJ4TN5VSTCAJ7LQI`
- Composer provider: `fal-ai/ace-step/prompt-to-audio`

## Important Caveat: Hidden Phrase

`INFORMANT_PASSPHRASE` still exists in worker config, but the actual Hidden Oracle proof system is now tied to the phrase baked into the generated ZK artifacts.

Current default phrase in artifact generation:

- `LIQUIDITY`

So changing only worker env is not enough. Rebuild the ZK package and verifier package too.

## Local Development

```bash
pnpm --filter @oraclehunt/workers dev
pnpm --filter @oraclehunt/workers typecheck
pnpm --filter @oraclehunt/workers test
```

Local `wrangler dev` defaults to `http://localhost:8787`.

## Debugging Tips

- If the browser shows `402`, inspect worker logs first; the browser can hide the real failure behind CORS or generic payment errors.
- If Composer breaks after several minutes, check:
  - `composer_sessions`
  - the fal.ai request id in `composer_sessions.smol_job_id`
  - the matching consultation row by `consultations.smol_job_id`
- If Hidden Oracle starts failing after a phrase change, verify that the ZK artifacts and verifier contract were regenerated together.
