'use client'

import type { ProcessingTraceStep } from '@/types'
import { generateHiddenOracleProof, type HiddenOracleChallenge } from './hidden-oracle-zk'

export interface HiddenOracleResult {
  fingerprint: string
  zkPortrait: string
  artifactImage?: string
  txHash?: string
  explorerUrl?: string
  contractExplorerUrl?: string
  fingerprintContractExplorerUrl?: string
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
 * Submit passphrase to unlock the Hidden Oracle. No x402 payment.
 */
export async function consultHiddenOracle(
  walletAddress: string,
  passphrase: string,
  options?: ProgressOptions,
): Promise<HiddenOracleResult> {
  options?.onProgress?.('request-hidden-challenge')
  const challengeResponse = await fetch('/api/hidden-oracle/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress }),
  })

  if (!challengeResponse.ok) {
    const err = await challengeResponse.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error((err as { error?: string }).error ?? `HTTP ${challengeResponse.status}`)
  }

  const challenge = await challengeResponse.json() as HiddenOracleChallenge
  options?.onProgress?.('hidden-challenge-ready')

  options?.onProgress?.('generate-hidden-proof')
  const { proof, publicSignals } = await generateHiddenOracleProof(walletAddress, passphrase, challenge)
  options?.onProgress?.('hidden-proof-generated')

  options?.onProgress?.('submit-hidden-proof')
  const response = await fetch('/api/hidden-oracle/consult', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress,
      challengeId: challenge.challengeId,
      proof,
      publicSignals,
    }),
  })

  if (response.status === 403) throw new Error('INVALID_PASSPHRASE')

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error((err as { error?: string }).error ?? `HTTP ${response.status}`)
  }

  options?.onProgress?.('hidden-oracle-response-received')
  return response.json() as Promise<HiddenOracleResult>
}
