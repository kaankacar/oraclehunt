'use client'

import { wrapFetchWithPayment, x402Client } from '@x402/fetch'
import { buildPasskeyPaymentScheme, loadWalletFromStorage } from './wallet'
import type { ProcessingTraceStep } from '@/types'

const WORKERS_URL = process.env.NEXT_PUBLIC_WORKERS_URL ?? 'http://localhost:8787'
const STELLAR_NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
  ? 'stellar:pubnet'
  : 'stellar:testnet'

export interface OracleResult {
  artifact: string
  artifactImage?: string  // base64 data URL, present for image-generating oracles (e.g. painter)
  oracleId: string
  txHash?: string
  explorerUrl?: string
  processingTrace: ProcessingTraceStep[]
  timestamp: string
}

export interface HiddenOracleResult {
  fingerprint: string
  zkPortrait: string
  artifactImage?: string
  txHash?: string
  explorerUrl?: string
  contractExplorerUrl?: string
  zkContractId?: string
  zkTxHash?: string
  zkVerifyTxHash?: string
  processingTrace: ProcessingTraceStep[]
  timestamp: string
}

interface ProgressOptions {
  onProgress?: (event: string) => void
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
  options?: ProgressOptions,
): Promise<OracleResult> {
  const stored = loadWalletFromStorage()
  if (!stored) throw new Error('No wallet found — please create or reconnect your wallet')

  options?.onProgress?.('prepare-payment-request')
  const scheme = buildPasskeyPaymentScheme(walletAddress, stored.keyIdBase64, options?.onProgress)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new x402Client().register(STELLAR_NETWORK as 'stellar:pubnet' | 'stellar:testnet', scheme as any)
  const payFetch = wrapFetchWithPayment(fetch, client)

  options?.onProgress?.('send-oracle-request')
  const response = await payFetch(`${WORKERS_URL}/oracle/${oracleId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, walletAddress }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.log('[x402] oracle response body:', body)
    let err: { error?: string; message?: string } = { error: 'Unknown error' }
    try { err = JSON.parse(body) } catch { /* ignore */ }
    const reason = err.message ?? err.error ?? `HTTP ${response.status}`
    throw new Error(reason)
  }

  options?.onProgress?.('oracle-response-received')
  return response.json() as Promise<OracleResult>
}

/**
 * Submit passphrase to unlock the Hidden Oracle. No x402 payment.
 */
export async function consultHiddenOracle(
  walletAddress: string,
  passphrase: string,
  options?: ProgressOptions,
): Promise<HiddenOracleResult> {
  options?.onProgress?.('validate-hidden-passphrase')
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

  options?.onProgress?.('hidden-oracle-response-received')
  return response.json() as Promise<HiddenOracleResult>
}
