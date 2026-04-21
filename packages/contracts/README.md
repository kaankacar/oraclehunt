# Soroban Fingerprint Contract

This package contains the wallet fingerprint contract used by the Hidden Oracle flow.

Package name:

- `zk-fingerprint`

Source:

- [`src/lib.rs`](./src/lib.rs)

## Purpose

The contract derives a deterministic, ZK-friendly fingerprint from:

- wallet address
- shared salt

It uses Poseidon on BN254-friendly inputs so the result can be reused inside the Hidden Oracle proof system.

## Current Deployed Contract

Current local/dev testnet contract id:

- `CCA6GIF5G75DLCTJNAWZQAFRATPE46PNSRQVXB2GZKNHBPKOXDTM3DUB`

## Public Functions

### `derive_fingerprint(wallet, salt) -> BytesN<32>`

Returns a deterministic 32-byte fingerprint for a wallet.

### `verify_fingerprint(wallet, salt, claimed) -> bool`

Recomputes the fingerprint and checks it against a claimed value.

## Implementation Notes

- uses `soroban-poseidon`
- maps the wallet address into a BN254 field element
- uses a 32-byte salt
- returns bytes, not a custom struct

This contract is invoked by the worker treasury flow, not directly by the browser.

## Build and Test

```bash
cargo test --manifest-path packages/contracts/Cargo.toml
cargo build --target wasm32v1-none --release --manifest-path packages/contracts/Cargo.toml
```

## Ownership in the App

This package is only one part of the Hidden Oracle stack.

It does not verify the Groth16 proof itself.

That verifier lives in:

- [`../hidden-oracle-verifier`](../hidden-oracle-verifier/README.md)
