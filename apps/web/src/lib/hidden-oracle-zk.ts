'use client'

import { nativeToScVal } from '@stellar/stellar-base'

const BN254_FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617')

type SnarkJsModule = {
  groth16: {
    fullProve(
      input: Record<string, string>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{ proof: unknown; publicSignals: string[] }>
  }
}

export interface HiddenOracleChallenge {
  challengeId: string
  nonce: string
  saltField: string
  expectedFingerprintField: string
  deriveTxHash: string
  deriveExplorerUrl: string
  fingerprintContractExplorerUrl: string
}

let snarkJsPromise: Promise<SnarkJsModule> | null = null

export async function generateHiddenOracleProof(
  walletAddress: string,
  passphrase: string,
  challenge: HiddenOracleChallenge,
): Promise<{ proof: unknown; publicSignals: string[] }> {
  const snarkjs = await loadSnarkJs()
  const phraseField = await stringToFieldDecimal(passphrase.trim().toUpperCase())
  const walletField = await walletAddressToFieldDecimal(walletAddress)

  return snarkjs.groth16.fullProve(
    {
      walletField,
      phraseField,
      saltField: challenge.saltField,
      nonce: challenge.nonce,
      expectedFingerprint: challenge.expectedFingerprintField,
      expectedPhraseField: phraseField,
    },
    '/zk/hidden_oracle.wasm',
    '/zk/hidden_oracle_final.zkey',
  )
}

async function loadSnarkJs(): Promise<SnarkJsModule> {
  snarkJsPromise ??= import('@/vendor/snarkjs.browser.esm.js') as Promise<SnarkJsModule>
  return snarkJsPromise
}

async function walletAddressToFieldDecimal(walletAddress: string): Promise<string> {
  const addressScValXdr = nativeToScVal(walletAddress, { type: 'address' }).toXDR()
  return bytesToFieldDecimal(addressScValXdr)
}

async function stringToFieldDecimal(input: string): Promise<string> {
  return bytesToFieldDecimal(new TextEncoder().encode(input))
}

async function bytesToFieldDecimal(input: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', (new Uint8Array(input)).buffer as ArrayBuffer)
  return bytesHexToFieldDecimal(new Uint8Array(hashBuffer))
}

function bytesHexToFieldDecimal(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return (BigInt(`0x${hex}`) % BN254_FIELD_MODULUS).toString()
}
