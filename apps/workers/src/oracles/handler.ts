import { createClient } from '@supabase/supabase-js'
import { ORACLE_PROMPTS, PAINTER_STYLE_PROMPTS } from './prompts'
import type {
  OracleId,
  Env,
  OracleRequest,
  OracleResponse,
  PainterStyle,
  ProcessingTraceStep,
} from '../types'
import { getTxExplorerUrl } from '../stellar'
import { ORACLE_PRICE_USDC, getOracleWalletAddress } from '../middleware/payment'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const TEXT_MODEL = 'gemini-2.5-flash'
const IMAGE_MODEL = 'gemini-2.5-flash-image'
const OPENAI_BASE = 'https://api.openai.com/v1'
const OPENAI_TEXT_MODEL = 'gpt-5.4-mini'
const OPENAI_IMAGE_MODEL = 'gpt-image-2'
const TEXT_ORACLES_WITH_PERSONALITY = new Set<OracleId>(['seer', 'scribe', 'informant'])
const GEMINI_FLASH_INPUT_PER_MILLION_USDC = 0.30
const GEMINI_FLASH_OUTPUT_PER_MILLION_USDC = 2.50
const GEMINI_IMAGE_ESTIMATED_COST_USDC = 0.039
const OPENAI_TEXT_INPUT_PER_MILLION_USDC = 0.75
const OPENAI_TEXT_OUTPUT_PER_MILLION_USDC = 4.50
const OPENAI_IMAGE_TEXT_INPUT_PER_MILLION_USDC = 5.00
const OPENAI_IMAGE_OUTPUT_PER_MILLION_USDC = 30.00
const OPENAI_IMAGE_ESTIMATED_COST_USDC = 0.04

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

interface OpenAIResponseOutputText {
  type?: string
  text?: string
}

interface OpenAIResponseOutput {
  type?: string
  content?: OpenAIResponseOutputText[]
}

interface OpenAITextResponse {
  output_text?: string
  output?: OpenAIResponseOutput[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
  error?: { message: string }
}

interface OpenAIImageData {
  b64_json?: string
  url?: string
  revised_prompt?: string
}

interface OpenAIImageResponse {
  data?: OpenAIImageData[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
  error?: { message: string }
}

export interface PersistedOracleResponse extends OracleResponse {
  consultationId: string
}

interface StellaThreadResponse {
  id?: string
  error?: string
  message?: string
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

async function openaiText(apiKey: string | undefined, systemPrompt: string, userMessage: string): Promise<GeminiTextResult> {
  if (!apiKey) throw new Error('OpenAI is unavailable: OPENAI_API_KEY is not configured.')

  const res = await fetch(`${OPENAI_BASE}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_TEXT_MODEL,
      instructions: systemPrompt,
      input: userMessage,
      max_output_tokens: 700,
    }),
  })
  const json = await res.json().catch(() => ({})) as OpenAITextResponse
  if (!res.ok || json.error) {
    throw new Error(`OpenAI error: ${json.error?.message ?? `HTTP ${res.status}`}`)
  }

  const text = extractOpenAIText(json)
  if (!text.trim()) throw new Error('OpenAI returned empty text.')

  return {
    text,
    promptTokenCount: json.usage?.input_tokens,
    candidateTokenCount: json.usage?.output_tokens,
    totalTokenCount: json.usage?.total_tokens,
  }
}

async function openaiImage(
  apiKey: string | undefined,
  prompt: string,
): Promise<GeminiTextResult & { imageDataUrl?: string }> {
  if (!apiKey) throw new Error('OpenAI is unavailable: OPENAI_API_KEY is not configured.')

  const res = await fetch(`${OPENAI_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt,
      size: '1024x1024',
      quality: 'medium',
      n: 1,
    }),
  })
  const json = await res.json().catch(() => ({})) as OpenAIImageResponse
  if (!res.ok || json.error) {
    throw new Error(`OpenAI image error: ${json.error?.message ?? `HTTP ${res.status}`}`)
  }

  const image = json.data?.[0]
  if (!image?.b64_json && !image?.url) {
    throw new Error('Painter generation returned no image. Please try again.')
  }

  const imageDataUrl = image.b64_json
    ? `data:image/png;base64,${image.b64_json}`
    : await imageUrlToDataUrl(image.url as string)

  return {
    text: image.revised_prompt ?? 'Your image has been rendered.',
    imageDataUrl,
    promptTokenCount: json.usage?.input_tokens,
    candidateTokenCount: json.usage?.output_tokens,
    totalTokenCount: json.usage?.total_tokens,
  }
}

function extractOpenAIText(json: OpenAITextResponse): string {
  if (typeof json.output_text === 'string') return json.output_text

  const chunks: string[] = []
  for (const output of json.output ?? []) {
    for (const content of output.content ?? []) {
      if ((content.type === 'output_text' || content.type === 'text') && content.text) {
        chunks.push(content.text)
      }
    }
  }

  return chunks.join('\n').trim()
}

async function imageUrlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Painter generated an image URL but it could not be fetched: HTTP ${response.status}`)

  const contentType = response.headers.get('content-type') ?? 'image/png'
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }

  return `data:${contentType};base64,${btoa(binary)}`
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
    throw new Error('Stella is unavailable: Stella env vars are not configured.')
  }

  const threadsUrl = env.STELLA_API_URL.replace(/\/+$/, '')
  const headers = {
    'x-api-key': env.STELLA_API_KEY,
    'Content-Type': 'application/json',
  }
  const threadResponse = await fetch(threadsUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messages: [{ role: 'user', content: req.prompt }],
    }),
  })
  const threadJson = await threadResponse.json().catch(() => ({})) as StellaThreadResponse
  if (!threadResponse.ok || !threadJson.id) {
    throw new Error(`Stella is unavailable: ${threadJson.message ?? threadJson.error ?? `HTTP ${threadResponse.status}`}`)
  }

  const messageResponse = await fetch(`${threadsUrl}/${encodeURIComponent(threadJson.id)}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ role: 'user', content: req.prompt }),
  })
  if (!messageResponse.ok) {
    const messageJson = await messageResponse.json().catch(() => ({})) as StellaThreadResponse
    throw new Error(`Stella is unavailable: ${messageJson.message ?? messageJson.error ?? `HTTP ${messageResponse.status}`}`)
  }

  const runResponse = await fetch(`${threadsUrl}/${encodeURIComponent(threadJson.id)}/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
  const runText = await runResponse.text()
  if (!runResponse.ok) {
    const runJson = parseJson(runText) as StellaThreadResponse | undefined
    throw new Error(`Stella is unavailable: ${runJson?.message ?? runJson?.error ?? `HTTP ${runResponse.status}`}`)
  }

  const answer = parseStellaRunText(runText)
  if (!answer?.trim()) {
    throw new Error('Stella is unavailable: Stella returned empty content.')
  }

  return stripMarkdownSyntax(answer)
}

function parseStellaRunText(text: string): string | undefined {
  const json = parseJson(text)
  const directText = extractStellaText(json)
  if (directText) return directText

  const chunks: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const payload = parseJson(line.slice(5).trim()) as { type?: string; content?: string } | undefined
    if (payload?.type === 'content' && typeof payload.content === 'string') {
      chunks.push(payload.content)
    }
  }

  return chunks.join('')
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```[a-z]*\n?/gi, '').replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

function estimateOpenAITextCostUsdc(
  usage?: Pick<GeminiTextResult, 'promptTokenCount' | 'candidateTokenCount'>,
): number {
  const inputTokens = usage?.promptTokenCount ?? 900
  const outputTokens = usage?.candidateTokenCount ?? 500
  return Number((
    (inputTokens / 1_000_000) * OPENAI_TEXT_INPUT_PER_MILLION_USDC
    + (outputTokens / 1_000_000) * OPENAI_TEXT_OUTPUT_PER_MILLION_USDC
  ).toFixed(6))
}

function estimateOpenAIImageCostUsdc(
  usage?: Pick<GeminiTextResult, 'promptTokenCount' | 'candidateTokenCount'>,
): number {
  if (!usage?.promptTokenCount && !usage?.candidateTokenCount) return OPENAI_IMAGE_ESTIMATED_COST_USDC

  return Number((
    ((usage.promptTokenCount ?? 0) / 1_000_000) * OPENAI_IMAGE_TEXT_INPUT_PER_MILLION_USDC
    + ((usage.candidateTokenCount ?? 0) / 1_000_000) * OPENAI_IMAGE_OUTPUT_PER_MILLION_USDC
  ).toFixed(6))
}

function getPainterStyle(value: PainterStyle | undefined): PainterStyle {
  return value && value in PAINTER_STYLE_PROMPTS ? value : 'default'
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
          ? `OpenAI ${OPENAI_IMAGE_MODEL} returned the portrait.`
          : `OpenAI ${OPENAI_TEXT_MODEL} returned the oracle artifact.`
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
  let aiProvider = 'OpenAI'
  let aiModel = oracleId === 'painter' ? OPENAI_IMAGE_MODEL : OPENAI_TEXT_MODEL
  let estimatedModelCost: number | undefined

  if (oracleId === 'painter') {
    const painterStyle = getPainterStyle(req.painterStyle)
    const imageResult = await openaiImage(
      env.OPENAI_API_KEY,
      `${PAINTER_STYLE_PROMPTS[painterStyle]}\n\nSubject: ${req.prompt}`,
    )
    artifact = imageResult.text || 'Your pixel art portrait has been rendered.'
    artifactImage = imageResult.imageDataUrl
    promptTokenCount = imageResult.promptTokenCount
    candidateTokenCount = imageResult.candidateTokenCount
    totalTokenCount = imageResult.totalTokenCount
    oracleTraceDetail = `OpenAI ${OPENAI_IMAGE_MODEL} rendered the Painter image using the ${painterStyle.replace(/_/g, ' ')} style.`
    estimatedModelCost = estimateOpenAIImageCostUsdc({ promptTokenCount, candidateTokenCount })
  } else {
    if (oracleId === 'scholar') {
      try {
        artifact = await getStellaAnswer(req, env)
        oracleTraceDetail = 'Stella returned its answer directly without Gemini rewriting or personality styling.'
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
        oracleTraceDetail = `Stella used Gemini ${TEXT_MODEL} fallback because ${stellaReason}`
        aiProvider = 'Google Gemini'
        aiModel = TEXT_MODEL
      }
    } else {
      const systemPrompt = buildPersonalizedPrompt(oracleId, ORACLE_PROMPTS[oracleId], req.personality)
      const textResult = await openaiText(env.OPENAI_API_KEY, systemPrompt, req.prompt)
      artifact = textResult.text
      promptTokenCount = textResult.promptTokenCount
      candidateTokenCount = textResult.candidateTokenCount
      totalTokenCount = textResult.totalTokenCount
      estimatedModelCost = estimateOpenAITextCostUsdc({ promptTokenCount, candidateTokenCount })
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
