# Hidden Oracle ZK Package

This package owns the Circom circuit and artifact generation for the Hidden Oracle proof.

It is the source of truth for:

- the Groth16 circuit
- proving artifacts
- verification key export
- generated metadata used by the worker and frontend

## Folder Map

- `circuits/hidden_oracle.circom`: main circuit
- `scripts/generate-artifacts.mjs`: build pipeline
- `artifacts/metadata.json`: phrase + public signal metadata
- `artifacts/verification_key.json`: exported Groth16 verification key
- `build/`: generated wasm, zkey, ptau, and intermediate files

## What the Circuit Proves

Private witness:

- `walletField`
- `phraseField`
- `saltField`

Public inputs:

- `nonce`
- `expectedFingerprint`
- `expectedPhraseField`

Public output:

- `nullifier`

High-level statement:

- the prover knows a phrase and wallet-bound inputs that match the expected fingerprint context
- the phrase field matches the expected phrase field
- a nullifier is derived from fingerprint + phrase + nonce

## Current Phrase Behavior

The artifact build currently defaults to:

- `LIQUIDITY`

That value is normalized as:

- trim
- uppercase
- sha256
- reduce into the BN254 field

The result is baked into:

- `artifacts/metadata.json`
- `apps/workers/src/generated/hidden-oracle-zk-metadata.json`

Changing the Hidden Oracle phrase requires rebuilding this package.

## Build

```bash
cd packages/hidden-oracle-zk
pnpm build
```

The build script does all of this:

- compiles the circom circuit
- runs powers of tau setup
- contributes phase 1 entropy
- contributes phase 2 entropy
- exports the verification key
- copies wasm and zkey into `apps/web/public/zk`
- writes generated metadata for the worker
- regenerates verifier constants in `packages/hidden-oracle-verifier/src/generated.rs`

## Tooling Requirements

The script expects these tools on the machine:

- `circom`
- `snarkjs`

## Why This Package Matters

This is the package that makes the Hidden Oracle phrase an actual proof-bearing statement instead of a plain hash comparison.

If this package changes, the verifier contract package usually needs to be rebuilt too.
