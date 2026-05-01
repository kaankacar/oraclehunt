'use client'

import { wrapFetchWithPayment, x402Client } from '@x402/fetch'
import {
  buildPasskeyPaymentScheme,
  loadWalletFromStorage,
} from './wallet'
import type { OraclePersonality, PainterStyle, ProcessingTraceStep } from '@/types'

const WORKERS_URL = process.env.NEXT_PUBLIC_WORKERS_URL ?? 'http://localhost:8787'
const STELLAR_NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
  ? 'stellar:pubnet'
  : 'stellar:testnet'

export interface OracleResult {
  artifact: string
  artifactImage?: string  // base64 data URL, present for image-generating oracles (e.g. painter)
  audioUrl1?: string | null
  audioUrl2?: string | null
  oracleId: string
  txHash?: string
  explorerUrl?: string
  processingTrace: ProcessingTraceStep[]
  timestamp: string
}

export interface ComposerPendingResult {
  status: 'pending'
  oracleId: 'composer'
  jobId: string
  txHash?: string
  explorerUrl?: string
  processingTrace: ProcessingTraceStep[]
  timestamp: string
}

export interface ComposerErrorResult {
  status: 'error'
  oracleId: 'composer'
  error: string
  txHash?: string
  explorerUrl?: string
  processingTrace: ProcessingTraceStep[]
  timestamp: string
}

export type OracleConsultResponse =
  | OracleResult
  | ComposerPendingResult
  | ComposerErrorResult

interface ProgressOptions {
  onProgress?: (event: string) => void
}

async function readOracleError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  console.log('[x402] oracle response body:', body)

  let err: { error?: string; message?: string } = { error: 'Unknown error' }
  try {
    err = JSON.parse(body) as { error?: string; message?: string }
  } catch {
    err = { error: body || 'Unknown error' }
  }

  return err.message ?? err.error ?? `HTTP ${response.status}`
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
  options?: ProgressOptions & { personality?: OraclePersonality; painterStyle?: PainterStyle },
): Promise<OracleConsultResponse> {
  const stored = loadWalletFromStorage()
  if (!stored) throw new Error('No wallet found — please create or reconnect your wallet')

  options?.onProgress?.('prepare-payment-request')
  const scheme = buildPasskeyPaymentScheme(walletAddress, stored.keyIdBase64, options?.onProgress)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new x402Client().register(STELLAR_NETWORK as 'stellar:pubnet' | 'stellar:testnet', scheme as any)
  const payFetch = wrapFetchWithPayment(fetch, client)

  options?.onProgress?.('send-oracle-request')
  let response: Response
  try {
    response = await payFetch(`${WORKERS_URL}/oracle/${oracleId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        walletAddress,
        personality: options?.personality,
        painterStyle: options?.painterStyle,
      }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[x402] public oracle payment flow failed', {
      oracleId,
      walletAddress,
      message,
    })
    throw new Error(message)
  }

  if (!response.ok) {
    throw new Error(await readOracleError(response))
  }

  options?.onProgress?.('oracle-response-received')
  return response.json() as Promise<OracleConsultResponse>
}

export async function pollComposerJob(
  jobId: string,
): Promise<OracleResult | ComposerPendingResult | ComposerErrorResult> {
  const response = await fetch(`${WORKERS_URL}/oracle/composer/status/${jobId}`)
  if (!response.ok) {
    throw new Error(await readOracleError(response))
  }

  return response.json() as Promise<OracleResult | ComposerPendingResult | ComposerErrorResult>
}
