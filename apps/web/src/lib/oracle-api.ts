'use client'

import { wrapFetchWithPayment, x402Client } from '@x402/fetch'
import { ExactStellarScheme } from '@x402/stellar/exact/client'
import { buildX402Signer } from './wallet'

const WORKERS_URL = process.env.NEXT_PUBLIC_WORKERS_URL ?? 'http://localhost:8787'
const STELLAR_NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
  ? 'stellar:pubnet'
  : 'stellar:testnet'

export interface OracleResult {
  artifact: string
  oracleId: string
  txHash?: string
  timestamp: string
}

export interface HiddenOracleResult {
  fingerprint: string
  zkPortrait: string
  timestamp: string
}

/**
 * Consult a public Oracle. Handles x402 payment automatically:
 * 1. POST → 402 with payment requirements
 * 2. ExactStellarScheme builds + signs USDC payment using passkey
 * 3. Retry with PAYMENT-SIGNATURE header → 200 + artifact
 */
export async function consultOracle(
  oracleId: string,
  prompt: string,
  walletAddress: string,
): Promise<OracleResult> {
  const signer = buildX402Signer(walletAddress)
  const scheme = new ExactStellarScheme(signer)

  const client = new x402Client().register(STELLAR_NETWORK as 'stellar:pubnet' | 'stellar:testnet', scheme)
  const payFetch = wrapFetchWithPayment(fetch, client)

  const response = await payFetch(`${WORKERS_URL}/oracle/${oracleId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, walletAddress }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error((err as { error?: string }).error ?? `HTTP ${response.status}`)
  }

  return response.json() as Promise<OracleResult>
}

/**
 * Submit passphrase to unlock the Hidden Oracle. No x402 payment.
 */
export async function consultHiddenOracle(
  walletAddress: string,
  passphrase: string,
): Promise<HiddenOracleResult> {
  const response = await fetch(`${WORKERS_URL}/oracle/hidden`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress, passphrase }),
  })

  if (response.status === 403) throw new Error('INVALID_PASSPHRASE')

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error((err as { error?: string }).error ?? `HTTP ${response.status}`)
  }

  return response.json() as Promise<HiddenOracleResult>
}
