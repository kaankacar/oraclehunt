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
import { ORACLE_PRICE_USDC, getOracleWalletAddress } from '../middleware/payment'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const TEXT_MODEL = 'gemini-2.5-flash'
const IMAGE_MODEL = 'gemini-2.5-flash-image'
const TEXT_ORACLES_WITH_PERSONALITY = new Set<OracleId>(['seer', 'scribe', 'informant'])
const GEMINI_FLASH_INPUT_PER_MILLION_USDC = 0.30
const GEMINI_FLASH_OUTPUT_PER_MILLION_USDC = 2.50
const GEMINI_IMAGE_ESTIMATED_COST_USDC = 0.039

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  error?: { message: string }
}

interface GeminiTextResult {
  text: string
  promptTokenCount?: number
  candidateTokenCount?: number
  totalTokenCount?: number
}

export interface PersistedOracleResponse extends OracleResponse {
  consultationId: string
}

async function geminiText(apiKey: string, systemPrompt: string, userMessage: string): Promise<GeminiTextResult> {
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
  return {
    text: json.candidates?.[0]?.content?.parts?.find(p => p.text)?.text ?? '',
    promptTokenCount: json.usageMetadata?.promptTokenCount,
    candidateTokenCount: json.usageMetadata?.candidatesTokenCount,
    totalTokenCount: json.usageMetadata?.totalTokenCount,
  }
}

async function geminiImage(
  apiKey: string,
  prompt: string,
): Promise<GeminiTextResult & { imageDataUrl?: string }> {
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
      return {
        text,
        imageDataUrl,
        promptTokenCount: json.usageMetadata?.promptTokenCount,
        candidateTokenCount: json.usageMetadata?.candidatesTokenCount,
        totalTokenCount: json.usageMetadata?.totalTokenCount,
      }
    }
  }

  throw new Error('Painter generation returned no image. Please try again.')
}

function buildPersonalizedPrompt(oracleId: OracleId, basePrompt: string, personality: OracleRequest['personality']): string {
  if (!personality || personality === 'default' || !TEXT_ORACLES_WITH_PERSONALITY.has(oracleId)) {
    return basePrompt
  }

  const layer: Record<'sassy' | 'slam_poet' | 'crypto_degen', string> = {
    sassy: 'Personality override: keep the oracle role and output length, but replace archaic diction with sharp modern English. Do not use thou, thy, hath, dost, shall, ancient-scroll phrasing, or Shakespeare-style grammar unless the seeker explicitly asks for it. Add dry wit, pointed confidence, and playful bite without becoming rude.',
    slam_poet: 'Personality override: keep the oracle role and output length, but replace archaic diction with modern spoken-word cadence. Do not use thou, thy, hath, dost, shall, ancient-scroll phrasing, or Shakespeare-style grammar unless the seeker explicitly asks for it. Make the answer rhythmic, percussive, and performance-ready.',
    crypto_degen: 'Personality override: keep the oracle role and output length, but replace archaic diction with crypto-native modern English. Do not use thou, thy, hath, dost, shall, ancient-scroll phrasing, or Shakespeare-style grammar. Use market metaphors, on-chain slang, degen confidence, and wallet/ledger references, but do not give financial advice.',
  }

  return `${basePrompt}\n\n${layer[personality]}`
}

async function getStellaAnswer(req: OracleRequest, env: Env): Promise<string> {
  if (!env.STELLA_API_URL || !env.STELLA_API_KEY) {
    throw new Error('Scholar/Stella is unavailable: Stella env vars are not configured.')
  }

  const response = await fetch(env.STELLA_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STELLA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: req.prompt,
      prompt: req.prompt,
      message: req.prompt,
      messages: [{ role: 'user', content: req.prompt }],
    }),
  })
  const json = await response.json().catch(() => ({})) as {
    answer?: string
    context?: string
    text?: string
    result?: string
    output?: string
    content?: string
    data?: unknown
    message?: { content?: string } | string
    messages?: Array<{ content?: string } | string>
  }

  if (!response.ok) {
    throw new Error(`Scholar/Stella is unavailable: HTTP ${response.status}`)
  }

  const answer = extractStellaText(json)
  if (!answer?.trim()) {
    throw new Error('Scholar/Stella is unavailable: Stella returned empty content.')
  }

  return answer.trim()
}

function extractStellaText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  for (const key of ['answer', 'text', 'result', 'context', 'output', 'content']) {
    if (typeof record[key] === 'string') return record[key] as string
  }

  if (record.message) {
    const messageText = extractStellaText(record.message)
    if (messageText) return messageText
  }

  if (Array.isArray(record.messages)) {
    for (let i = record.messages.length - 1; i >= 0; i -= 1) {
      const messageText = extractStellaText(record.messages[i])
      if (messageText) return messageText
    }
  }

  return extractStellaText(record.data)
}

function estimateGeminiCostUsdc(
  oracleId: OracleId,
  usage?: Pick<GeminiTextResult, 'promptTokenCount' | 'candidateTokenCount'>,
): number {
  if (oracleId === 'painter') return GEMINI_IMAGE_ESTIMATED_COST_USDC

  const inputTokens = usage?.promptTokenCount ?? 900
  const outputTokens = usage?.candidateTokenCount ?? 500
  return Number((
    (inputTokens / 1_000_000) * GEMINI_FLASH_INPUT_PER_MILLION_USDC
    + (outputTokens / 1_000_000) * GEMINI_FLASH_OUTPUT_PER_MILLION_USDC
  ).toFixed(6))
}

function buildEconomics(
  env: Env,
  oracleId: OracleId,
  estimatedCost: number,
  aiProvider = 'Google Gemini',
  aiModel = oracleId === 'painter' ? IMAGE_MODEL : TEXT_MODEL,
) {
  const price = ORACLE_PRICE_USDC[oracleId]
  return {
    payment_amount_usdc: price,
    estimated_model_cost_usdc: estimatedCost,
    estimated_profit_usdc: Number((price - estimatedCost).toFixed(6)),
    oracle_wallet_address: getOracleWalletAddress(env, oracleId),
    ai_provider: aiProvider,
    ai_model: aiModel,
  }
}

function buildPublicOracleTrace(
  env: Env,
  oracleId: OracleId,
  txHash?: string,
  options?: {
    oracleDetail?: string
    saveDetail?: string
  },
): ProcessingTraceStep[] {
  const explorerUrl = txHash ? getTxExplorerUrl(env, txHash) : undefined

  return [
    {
      id: 'client:payment-request',
      label: 'Preparing x402 Payment Request',
      status: 'success',
      detail: 'The browser priced the request and assembled the exact USDC transfer for this oracle.',
    },
    {
      id: 'client:passkey-signature',
      label: 'Passkey Signature Approved',
      status: 'success',
      detail: 'The passkey wallet authorized the payment payload for this consultation.',
    },
    {
      id: 'client:request-dispatch',
      label: 'Paid Oracle Request Submitted',
      status: 'success',
      detail: 'The signed x402 payment payload was attached and sent to the oracle worker.',
    },
    {
      id: 'client:oracle-processing',
      label: 'Oracle Processing',
      status: 'success',
      detail: 'The worker accepted the paid request and invoked the oracle model.',
    },
    {
      id: 'client:supabase-save',
      label: 'Saving to Codex',
      status: 'success',
      detail: options?.saveDetail ?? 'The finished artifact was prepared for storage with payment and trace metadata.',
    },
    {
      id: 'payment-settled',
      label: 'Payment Settled on Stellar',
      status: txHash ? 'success' : 'pending',
      detail: txHash
        ? 'The sponsored x402 USDC payment was confirmed before the oracle responded.'
        : 'The worker accepted the payment and is waiting for settlement metadata.',
      txHash,
      links: explorerUrl ? [{ label: 'Open payment on Stellar Expert', url: explorerUrl }] : undefined,
    },
    {
      id: 'oracle-generated',
      label: 'Oracle Generated Artifact',
      status: 'success',
      detail: options?.oracleDetail ?? (
        oracleId === 'painter'
          ? 'Gemini image generation returned the portrait and caption.'
          : `Gemini ${TEXT_MODEL} returned the oracle artifact.`
      ),
    },
    {
      id: 'artifact-saved',
      label: 'Saved to Codex',
      status: 'success',
      detail: 'The consultation was written to Supabase and is visible in Codex, Gallery, and Leaderboard.',
    },
  ]
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
  let promptTokenCount: number | undefined
  let candidateTokenCount: number | undefined
  let totalTokenCount: number | undefined
  let oracleTraceDetail: string | undefined
  let aiProvider = 'Google Gemini'
  let aiModel = oracleId === 'painter' ? IMAGE_MODEL : TEXT_MODEL
  let estimatedModelCost: number | undefined

  if (oracleId === 'painter') {
    const imageResult = await geminiImage(
      env.GEMINI_API_KEY,
      `${PAINTER_IMAGE_PROMPT}\n\nSubject: ${req.prompt}`,
    )
    artifact = imageResult.text || 'Your pixel art portrait has been rendered.'
    artifactImage = imageResult.imageDataUrl
    promptTokenCount = imageResult.promptTokenCount
    candidateTokenCount = imageResult.candidateTokenCount
    totalTokenCount = imageResult.totalTokenCount
  } else {
    if (oracleId === 'scholar') {
      try {
        artifact = await getStellaAnswer(req, env)
        oracleTraceDetail = 'Scholar returned Stella answer directly without Gemini rewriting or personality styling.'
        promptTokenCount = 0
        candidateTokenCount = 0
        totalTokenCount = 0
        estimatedModelCost = 0
        aiProvider = 'Stella'
        aiModel = 'stella'
      } catch (error) {
        const textResult = await geminiText(env.GEMINI_API_KEY, ORACLE_PROMPTS.scholar, req.prompt)
        artifact = textResult.text
        promptTokenCount = textResult.promptTokenCount
        candidateTokenCount = textResult.candidateTokenCount
        totalTokenCount = textResult.totalTokenCount
        const stellaReason = error instanceof Error ? error.message : 'Stella is unavailable.'
        oracleTraceDetail = `Scholar used Gemini ${TEXT_MODEL} because ${stellaReason}`
      }
    } else {
      const systemPrompt = buildPersonalizedPrompt(oracleId, ORACLE_PROMPTS[oracleId], req.personality)
      const textResult = await geminiText(env.GEMINI_API_KEY, systemPrompt, req.prompt)
      artifact = textResult.text
      promptTokenCount = textResult.promptTokenCount
      candidateTokenCount = textResult.candidateTokenCount
      totalTokenCount = textResult.totalTokenCount
    }
  }

  const timestamp = new Date().toISOString()
  const processingTrace = buildPublicOracleTrace(env, oracleId, txHash, {
    oracleDetail: oracleTraceDetail,
  })
  const modelCost = estimatedModelCost ?? estimateGeminiCostUsdc(oracleId, { promptTokenCount, candidateTokenCount })
  const economics = buildEconomics(env, oracleId, modelCost, aiProvider, aiModel)

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
      ...economics,
      input_tokens: promptTokenCount ?? null,
      output_tokens: candidateTokenCount ?? null,
      total_tokens: totalTokenCount ?? null,
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
    explorerUrl: txHash ? getTxExplorerUrl(env, txHash) : undefined,
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
