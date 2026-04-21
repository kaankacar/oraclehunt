import { createClient } from '@supabase/supabase-js'
import { ORACLE_PROMPTS, PAINTER_IMAGE_PROMPT } from './prompts'
import type {
  OracleId,
  Env,
  OracleRequest,
  OracleResponse,
  ProcessingTraceStep,
} from '../types'
import { getTxExplorerUrl } from '../stellar'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const TEXT_MODEL = 'gemini-2.5-flash'
const IMAGE_MODEL = 'gemini-2.5-flash-image'

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>
  error?: { message: string }
}

export interface PersistedOracleResponse extends OracleResponse {
  consultationId: string
}

async function geminiText(apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch(`${GEMINI_BASE}/${TEXT_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    }),
  })
  const json = await res.json() as GeminiResponse
  if (json.error) throw new Error(`Gemini error: ${json.error.message}`)
  return json.candidates?.[0]?.content?.parts?.find(p => p.text)?.text ?? ''
}

async function geminiImage(
  apiKey: string,
  prompt: string,
): Promise<{ text: string; imageDataUrl?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${GEMINI_BASE}/${IMAGE_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    })
    const json = await res.json() as GeminiResponse
    if (json.error) throw new Error(`Gemini error: ${json.error.message}`)

    const parts = json.candidates?.[0]?.content?.parts ?? []
    const text = parts.find(p => p.text)?.text ?? ''
    const img = parts.find(p => p.inlineData)?.inlineData
    const imageDataUrl = img ? `data:${img.mimeType};base64,${img.data}` : undefined

    if (imageDataUrl) {
      return { text, imageDataUrl }
    }
  }

  throw new Error('Painter generation returned no image. Please try again.')
}

export async function handleOracle(
  oracleId: OracleId,
  req: OracleRequest,
  env: Env,
  txHash?: string,
): Promise<PersistedOracleResponse> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { data: wallet, error: walletError } = await supabase
    .from('wallets')
    .select('id')
    .eq('stellar_address', req.walletAddress)
    .single()

  if (walletError || !wallet) {
    throw new Error(`Wallet registration missing for ${req.walletAddress}`)
  }

  let artifact: string
  let artifactImage: string | undefined

  if (oracleId === 'painter') {
    const { text, imageDataUrl } = await geminiImage(
      env.GEMINI_API_KEY,
      `${PAINTER_IMAGE_PROMPT}\n\nSubject: ${req.prompt}`,
    )
    artifact = text || 'Your pixel art portrait has been rendered.'
    artifactImage = imageDataUrl
  } else {
    artifact = await geminiText(env.GEMINI_API_KEY, ORACLE_PROMPTS[oracleId], req.prompt)
  }

  const timestamp = new Date().toISOString()
  const explorerUrl = txHash ? getTxExplorerUrl(env, txHash) : undefined
  const processingTrace: ProcessingTraceStep[] = [
    {
      id: 'payment-settled',
      label: 'Payment Settled on Stellar',
      status: 'success',
      detail: txHash
        ? 'The sponsored x402 USDC payment was confirmed before the oracle responded.'
        : 'Oracle request completed without a recorded payment transaction hash.',
      txHash,
      links: explorerUrl ? [{ label: 'Open payment on Stellar Expert', url: explorerUrl }] : undefined,
    },
    {
      id: 'oracle-generated',
      label: 'Oracle Generated Artifact',
      status: 'success',
      detail: oracleId === 'painter'
        ? 'Gemini image generation returned the portrait and caption.'
        : `Gemini ${TEXT_MODEL} returned the oracle artifact.`,
    },
    {
      id: 'artifact-saved',
      label: 'Saved to Codex',
      status: 'success',
      detail: 'The consultation was written to Supabase and is visible in Codex, Gallery, and Leaderboard.',
    },
  ]

  const { data: inserted, error: insertError } = await supabase
    .from('consultations')
    .insert({
      wallet_id: wallet.id,
      oracle_id: oracleId,
      prompt: req.prompt,
      artifact_text: artifact,
      artifact_image: artifactImage ?? null,
      tx_hash: txHash ?? null,
      processing_trace: processingTrace,
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    throw new Error(`Failed to persist consultation: ${insertError?.message ?? 'unknown error'}`)
  }

  return {
    artifact,
    artifactImage,
    oracleId,
    txHash,
    explorerUrl,
    processingTrace,
    timestamp,
    consultationId: inserted.id as string,
  }
}

export function applyPaymentSettlementToTrace(
  env: Env,
  processingTrace: ProcessingTraceStep[],
  txHash: string,
  detail = 'The sponsored x402 USDC payment was confirmed before the oracle responded.',
): ProcessingTraceStep[] {
  const explorerUrl = getTxExplorerUrl(env, txHash)

  return processingTrace.map((step) => (
    step.id === 'payment-settled'
      ? {
          ...step,
          status: 'success',
          detail,
          txHash,
          links: [{ label: 'Open payment on Stellar Expert', url: explorerUrl }],
        }
      : step
  ))
}

export async function attachOracleSettlement(
  consultationId: string,
  txHash: string,
  env: Env,
): Promise<{ explorerUrl: string; processingTrace: ProcessingTraceStep[] }> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase
    .from('consultations')
    .select('processing_trace')
    .eq('id', consultationId)
    .single()

  if (error || !data) {
    throw new Error(`Failed to load consultation for settlement update: ${error?.message ?? 'unknown error'}`)
  }

  const processingTrace = applyPaymentSettlementToTrace(
    env,
    (data.processing_trace as ProcessingTraceStep[] | null) ?? [],
    txHash,
  )
  const explorerUrl = getTxExplorerUrl(env, txHash)

  const { error: updateError } = await supabase
    .from('consultations')
    .update({
      tx_hash: txHash,
      processing_trace: processingTrace,
    })
    .eq('id', consultationId)

  if (updateError) {
    throw new Error(`Failed to persist settlement metadata: ${updateError.message}`)
  }

  return { explorerUrl, processingTrace }
}
