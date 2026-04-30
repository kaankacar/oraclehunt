import { createClient } from '@supabase/supabase-js'
import { getTxExplorerUrl } from '../stellar'
import { applyPaymentSettlementToTrace } from './handler'
import { ORACLE_PRICE_USDC, getOracleWalletAddress } from '../middleware/payment'
import type {
  ComposerErrorResponse,
  ComposerPendingResponse,
  Env,
  OracleRequest,
  OracleResponse,
  ProcessingTraceStep,
} from '../types'

type ComposerSessionStatus = 'queued' | 'processing' | 'complete' | 'error'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const COMPOSER_TEXT_MODEL = 'gemini-2.5-flash'
const DEFAULT_MINIMAX_MODEL = 'minimax/music-2.6'
const GEMINI_FLASH_INPUT_PER_MILLION_USDC = 0.30
const GEMINI_FLASH_OUTPUT_PER_MILLION_USDC = 2.50

interface GeminiComposerResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  error?: { message: string }
}

interface ComposerGenerationResult {
  artifactText: string
  audioUrl: string | null
  audioStored: boolean
  aiProvider: string
  aiModel: string
  estimatedModelCostUsdc: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  textFallbackReason?: string
}

interface WalletRow {
  id: string
  stellar_address: string
}

interface ComposerSessionRow {
  id: string
  wallet_id: string
  stellar_address: string
  tx_hash: string
  prompt: string
  status: ComposerSessionStatus
  error_message: string | null
  created_at: string
  completed_at: string | null
}

interface ConsultationRow {
  id: string
  wallet_id: string
  prompt: string
  artifact_text: string
  artifact_image: string | null
  audio_url_1: string | null
  audio_url_2: string | null
  tx_hash: string | null
  processing_trace: ProcessingTraceStep[] | null
  created_at: string
}

export interface ComposerQueueMessage {
  sessionId: string
}

function isConfirmedStellarTxHash(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{64}$/i.test(value))
}

function nowIso(): string {
  return new Date().toISOString()
}

function getComposerEstimatedCostUsdc(env: Env): number {
  const configured = Number(env.COMPOSER_ESTIMATED_COST_USDC)
  return Number.isFinite(configured) && configured >= 0 ? configured : 0.0019
}

function buildComposerEconomics(
  env: Env,
  options?: {
    estimatedModelCostUsdc?: number
    aiProvider?: string
    aiModel?: string
  },
) {
  const cost = options?.estimatedModelCostUsdc ?? getComposerEstimatedCostUsdc(env)
  const price = ORACLE_PRICE_USDC.composer

  return {
    payment_amount_usdc: price,
    estimated_model_cost_usdc: cost,
    estimated_profit_usdc: Number((price - cost).toFixed(6)),
    oracle_wallet_address: getOracleWalletAddress(env, 'composer'),
    ai_provider: options?.aiProvider ?? 'Cloudflare Workers AI',
    ai_model: options?.aiModel ?? (env.COMPOSER_MODEL ?? DEFAULT_MINIMAX_MODEL),
  }
}

function getWorkerPublicUrl(env: Env): string {
  return (env.WORKERS_PUBLIC_URL ?? 'https://oraclehunt-workers.kaankacar02.workers.dev').replace(/\/+$/, '')
}

function composerAudioUrl(env: Env, key: string): string {
  return `${getWorkerPublicUrl(env)}/composer/audio/${encodeURIComponent(key)}`
}

function buildComposerTrace(
  env: Env,
  session: ComposerSessionRow,
  options?: {
    processing?: boolean
    audioStored?: boolean
    saved?: boolean
    errorMessage?: string
    textFallbackReason?: string
  },
): ProcessingTraceStep[] {
  const paymentExplorerUrl = isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined

  return [
    {
      id: 'payment-settled',
      label: 'Payment Settled on Stellar',
      status: 'success',
      detail: isConfirmedStellarTxHash(session.tx_hash)
        ? 'The x402 USDC payment settled before Composer generation was queued.'
        : 'Composer payment was accepted. The worker is carrying an internal payment reference until settlement metadata is available.',
      txHash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : undefined,
      links: paymentExplorerUrl ? [{ label: 'Open payment on Stellar Expert', url: paymentExplorerUrl }] : undefined,
    },
    {
      id: 'composer-session-queued',
      label: 'Queued Music Generation',
      status: 'success',
      detail: `Composer queued session ${session.id}.`,
    },
    {
      id: 'composer-minimax-generation',
      label: 'Generating Song with MiniMax',
      status: options?.errorMessage ? 'error' : options?.processing || options?.audioStored || options?.saved ? 'success' : 'pending',
      detail: options?.errorMessage
        ? options.errorMessage
        : options?.textFallbackReason
          ? options.textFallbackReason
        : options?.processing || options?.audioStored || options?.saved
          ? `Cloudflare Workers AI accepted the ${env.COMPOSER_MODEL ?? DEFAULT_MINIMAX_MODEL} generation request.`
          : `The queue consumer will invoke ${env.COMPOSER_MODEL ?? DEFAULT_MINIMAX_MODEL} for one original song.`,
    },
    {
      id: 'composer-audio-stored',
      label: options?.textFallbackReason ? 'Audio Generation Skipped' : 'Stored MP3',
      status: options?.errorMessage ? 'error' : options?.audioStored || options?.saved ? 'success' : 'pending',
      detail: options?.errorMessage
        ? options.errorMessage
        : options?.textFallbackReason
          ? 'Composer saved a text song artifact because this Cloudflare account cannot run the requested music model yet.'
        : options?.audioStored || options?.saved
          ? 'The generated audio URL was persisted for playback.'
          : 'The generated audio URL will be fetched and persisted when audio storage is available.',
    },
    {
      id: 'composer-saved',
      label: 'Saved to Codex',
      status: options?.errorMessage ? 'error' : options?.saved ? 'success' : 'pending',
      detail: options?.errorMessage
        ? options.errorMessage
        : options?.saved
          ? 'The completed Composer artifact was written to Supabase and is now visible in Codex and Gallery.'
          : 'The Composer will save the artifact as soon as generation finishes.',
    },
  ]
}

function composerArtifactText(prompt: string): string {
  return `Original song generated for:\n${prompt}`
}

async function getWalletForComposer(env: Env, walletAddress: string): Promise<WalletRow> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase
    .from('wallets')
    .select('id, stellar_address')
    .eq('stellar_address', walletAddress)
    .single()

  if (error || !data) {
    throw new Error(`Wallet registration missing for ${walletAddress}`)
  }

  return data as WalletRow
}

async function selectComposerSessionByTxHash(env: Env, txHash: string): Promise<ComposerSessionRow | null> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase
    .from('composer_sessions')
    .select('id, wallet_id, stellar_address, tx_hash, prompt, status, error_message, created_at, completed_at')
    .eq('tx_hash', txHash)
    .maybeSingle()

  if (error) throw new Error(`Failed to load composer session: ${error.message}`)
  return (data as ComposerSessionRow | null) ?? null
}

async function selectComposerSessionById(env: Env, sessionId: string): Promise<ComposerSessionRow | null> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase
    .from('composer_sessions')
    .select('id, wallet_id, stellar_address, tx_hash, prompt, status, error_message, created_at, completed_at')
    .eq('id', sessionId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load composer session: ${error.message}`)
  return (data as ComposerSessionRow | null) ?? null
}

async function createOrLoadComposerSession(
  env: Env,
  wallet: WalletRow,
  prompt: string,
  txHash: string,
): Promise<{ session: ComposerSessionRow; created: boolean }> {
  const existing = await selectComposerSessionByTxHash(env, txHash)
  if (existing) {
    if (existing.stellar_address !== wallet.stellar_address) {
      throw new Error('Composer session belongs to a different wallet.')
    }
    return { session: existing, created: false }
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const economics = buildComposerEconomics(env)
  const { data, error } = await supabase
    .from('composer_sessions')
    .insert({
      wallet_id: wallet.id,
      stellar_address: wallet.stellar_address,
      tx_hash: txHash,
      prompt,
      status: 'queued',
      payment_amount_usdc: economics.payment_amount_usdc,
      estimated_model_cost_usdc: economics.estimated_model_cost_usdc,
      estimated_profit_usdc: economics.estimated_profit_usdc,
      oracle_wallet_address: economics.oracle_wallet_address,
      ai_provider: economics.ai_provider,
      ai_model: economics.ai_model,
    })
    .select('id, wallet_id, stellar_address, tx_hash, prompt, status, error_message, created_at, completed_at')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create composer session: ${error?.message ?? 'unknown error'}`)
  }

  return { session: data as ComposerSessionRow, created: true }
}

async function updateComposerSession(
  env: Env,
  sessionId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { error } = await supabase
    .from('composer_sessions')
    .update({
      ...updates,
      updated_at: nowIso(),
    })
    .eq('id', sessionId)

  if (error) {
    throw new Error(`Failed to update composer session: ${error.message}`)
  }
}

async function findCompletedComposerConsultation(env: Env, sessionId: string): Promise<ConsultationRow | null> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase
    .from('consultations')
    .select('id, wallet_id, prompt, artifact_text, artifact_image, audio_url_1, audio_url_2, tx_hash, processing_trace, created_at')
    .eq('composer_session_id', sessionId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load composer consultation: ${error.message}`)
  return (data as ConsultationRow | null) ?? null
}

function completedResponseFromRow(env: Env, row: ConsultationRow): OracleResponse {
  return {
    artifact: row.artifact_text,
    artifactImage: row.artifact_image ?? undefined,
    audioUrl1: row.audio_url_1 ?? null,
    audioUrl2: row.audio_url_2 ?? null,
    oracleId: 'composer',
    txHash: isConfirmedStellarTxHash(row.tx_hash) ? row.tx_hash : undefined,
    explorerUrl: isConfirmedStellarTxHash(row.tx_hash) ? getTxExplorerUrl(env, row.tx_hash) : undefined,
    processingTrace: row.processing_trace ?? [],
    timestamp: row.created_at,
  }
}

async function enqueueComposerGeneration(env: Env, sessionId: string): Promise<void> {
  const queue = requireComposerQueue(env)
  await queue.send({ sessionId } satisfies ComposerQueueMessage)
}

export async function handleComposerOracle(
  req: OracleRequest,
  env: Env,
  txHash?: string,
): Promise<ComposerPendingResponse | ComposerErrorResponse | OracleResponse> {
  if (!txHash) {
    throw new Error('Composer requires a verified payment reference.')
  }

  const wallet = await getWalletForComposer(env, req.walletAddress)
  const { session, created } = await createOrLoadComposerSession(env, wallet, req.prompt, txHash)

  if (created) {
    await enqueueComposerGeneration(env, session.id)
  }

  return pollComposerStatus(session.id, env)
}

export async function resumeComposerOracle(
  walletAddress: string,
  txHash: string,
  env: Env,
): Promise<ComposerPendingResponse | ComposerErrorResponse | OracleResponse> {
  const wallet = await getWalletForComposer(env, walletAddress)
  const session = await selectComposerSessionByTxHash(env, txHash)

  if (!session || session.wallet_id !== wallet.id) {
    throw new Error('Composer session not found for this wallet and payment.')
  }

  return pollComposerStatus(session.id, env)
}

export async function pollComposerStatus(
  sessionId: string,
  env: Env,
): Promise<ComposerPendingResponse | OracleResponse | ComposerErrorResponse> {
  const session = await selectComposerSessionById(env, sessionId)
  if (!session) {
    return {
      status: 'error',
      oracleId: 'composer',
      error: 'Composer session not found.',
      processingTrace: [],
      timestamp: nowIso(),
    }
  }

  const existing = await findCompletedComposerConsultation(env, sessionId)
  if (existing) {
    return completedResponseFromRow(env, existing)
  }

  if (session.status === 'error') {
    const message = session.error_message ?? 'Composer generation failed.'
    return {
      status: 'error',
      oracleId: 'composer',
      error: message,
      txHash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : undefined,
      explorerUrl: isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined,
      processingTrace: buildComposerTrace(env, session, { errorMessage: message }),
      timestamp: nowIso(),
    }
  }

  return {
    status: 'pending',
    oracleId: 'composer',
    jobId: session.id,
    txHash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : undefined,
    explorerUrl: isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined,
    processingTrace: buildComposerTrace(env, session, { processing: session.status === 'processing' }),
    timestamp: nowIso(),
  }
}

export async function processComposerQueue(batch: MessageBatch<ComposerQueueMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processComposerSession(message.body.sessionId, env)
      message.ack()
    } catch (error) {
      console.error('Composer queue message failed:', error)
      message.retry()
    }
  }
}

async function processComposerSession(sessionId: string, env: Env): Promise<void> {
  const session = await selectComposerSessionById(env, sessionId)
  if (!session || session.status === 'complete') return

  const existing = await findCompletedComposerConsultation(env, sessionId)
  if (existing) {
    await updateComposerSession(env, sessionId, {
      status: 'complete',
      completed_at: existing.created_at,
      error_message: null,
    })
    return
  }

  try {
    await updateComposerSession(env, sessionId, {
      status: 'processing',
      error_message: null,
    })

    const timestamp = nowIso()
    const generation = await generateComposerArtifact(env, session)
    const processingTrace = buildComposerTrace(env, session, {
      processing: true,
      audioStored: generation.audioStored,
      saved: true,
      textFallbackReason: generation.textFallbackReason,
    })

    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
    const { error: insertError } = await supabase
      .from('consultations')
      .insert({
        wallet_id: session.wallet_id,
        oracle_id: 'composer',
        prompt: session.prompt,
        artifact_text: generation.artifactText,
        artifact_image: null,
        audio_url_1: generation.audioUrl,
        audio_url_2: null,
        composer_session_id: session.id,
        smol_job_id: null,
        tx_hash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : null,
        processing_trace: processingTrace,
        ...buildComposerEconomics(env, {
          estimatedModelCostUsdc: generation.estimatedModelCostUsdc,
          aiProvider: generation.aiProvider,
          aiModel: generation.aiModel,
        }),
        input_tokens: generation.inputTokens,
        output_tokens: generation.outputTokens,
        total_tokens: generation.totalTokens,
      })

    if (insertError) {
      throw new Error(`Failed to insert composer consultation: ${insertError.message}`)
    }

    await updateComposerSession(env, sessionId, {
      status: 'complete',
      completed_at: timestamp,
      error_message: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Composer generation failed.'
    await updateComposerSession(env, sessionId, {
      status: 'error',
      error_message: message,
    })
  }
}

async function generateComposerArtifact(env: Env, session: ComposerSessionRow): Promise<ComposerGenerationResult> {
  try {
    const ai = requireComposerAI(env)
    const model = env.COMPOSER_MODEL ?? DEFAULT_MINIMAX_MODEL
    const generation = await ai.run(model, {
      prompt: session.prompt,
      lyrics_optimizer: true,
      is_instrumental: false,
      format: 'mp3',
    })
    const generatedAudioUrl = extractAudioUrl(generation)
    const audioUrl = await storeComposerAudioIfAvailable(env, session.id, generatedAudioUrl)

    return {
      artifactText: composerArtifactText(session.prompt),
      audioUrl,
      audioStored: audioUrl !== generatedAudioUrl,
      aiProvider: 'Cloudflare Workers AI',
      aiModel: model,
      estimatedModelCostUsdc: getComposerEstimatedCostUsdc(env),
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'MiniMax generation failed.'
    return generateComposerTextFallback(env, session.prompt, reason)
  }
}

async function generateComposerTextFallback(
  env: Env,
  prompt: string,
  reason: string,
): Promise<ComposerGenerationResult> {
  const response = await fetch(`${GEMINI_BASE}/${COMPOSER_TEXT_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: 'You are OracleHunt Composer. Write one complete, original song artifact for the user prompt. Include a title, short style note, lyrics with verses and chorus, and a concise production direction. Do not claim that audio was generated.',
        }],
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }),
  })
  const json = await response.json() as GeminiComposerResponse
  if (json.error) throw new Error(`Composer MiniMax failed (${reason}) and Gemini fallback failed: ${json.error.message}`)

  const artifactText = json.candidates?.[0]?.content?.parts?.find(part => part.text)?.text?.trim()
  if (!artifactText) {
    throw new Error(`Composer MiniMax failed (${reason}) and Gemini fallback returned empty content.`)
  }

  const inputTokens = json.usageMetadata?.promptTokenCount ?? null
  const outputTokens = json.usageMetadata?.candidatesTokenCount ?? null
  const estimatedCost = estimateGeminiComposerCost(inputTokens, outputTokens)

  return {
    artifactText,
    audioUrl: null,
    audioStored: false,
    aiProvider: 'Google Gemini',
    aiModel: COMPOSER_TEXT_MODEL,
    estimatedModelCostUsdc: estimatedCost,
    inputTokens,
    outputTokens,
    totalTokens: json.usageMetadata?.totalTokenCount ?? null,
    textFallbackReason: `MiniMax audio generation is unavailable on this Cloudflare account (${reason}). Composer completed with a Gemini song artifact instead.`,
  }
}

function estimateGeminiComposerCost(inputTokens: number | null, outputTokens: number | null): number {
  const input = inputTokens ?? 900
  const output = outputTokens ?? 700
  return Number((
    (input / 1_000_000) * GEMINI_FLASH_INPUT_PER_MILLION_USDC
    + (output / 1_000_000) * GEMINI_FLASH_OUTPUT_PER_MILLION_USDC
  ).toFixed(6))
}

function extractAudioUrl(result: unknown): string {
  const candidates = collectStrings(result)
  const audioUrl = candidates.find((value) => /^https?:\/\/.+/i.test(value))
  if (!audioUrl) {
    throw new Error('MiniMax did not return an audio URL.')
  }
  return audioUrl
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(collectStrings)

  const out: string[] = []
  for (const nested of Object.values(value)) {
    out.push(...collectStrings(nested))
  }
  return out
}

async function storeComposerAudioIfAvailable(env: Env, sessionId: string, generatedAudioUrl: string): Promise<string> {
  if (!env.COMPOSER_AUDIO) {
    return generatedAudioUrl
  }

  const audioResponse = await fetch(generatedAudioUrl)
  if (!audioResponse.ok) {
    throw new Error(`MiniMax audio fetch failed with HTTP ${audioResponse.status}`)
  }

  const audioBytes = await audioResponse.arrayBuffer()
  const audioKey = `${sessionId}.mp3`
  await env.COMPOSER_AUDIO.put(audioKey, audioBytes, {
    httpMetadata: { contentType: 'audio/mpeg' },
  })

  return composerAudioUrl(env, audioKey)
}

export async function getComposerAudio(env: Env, key: string): Promise<Response> {
  if (!env.COMPOSER_AUDIO) {
    return new Response('Composer audio bucket is not configured', { status: 503 })
  }

  const object = await env.COMPOSER_AUDIO.get(key)
  if (!object) {
    return new Response('Not found', { status: 404 })
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'audio/mpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

function requireComposerAI(env: Env) {
  if (!env.AI) {
    throw new Error('Composer AI binding is not configured')
  }
  return env.AI
}

function requireComposerQueue(env: Env) {
  if (!env.COMPOSER_QUEUE) {
    throw new Error('Composer queue binding is not configured')
  }
  return env.COMPOSER_QUEUE
}

export async function reconcileComposerSettlement(
  env: Env,
  provisionalPaymentRef: string | undefined,
  settledTxHash: string,
): Promise<void> {
  if (!provisionalPaymentRef || provisionalPaymentRef === settledTxHash) return

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)

  const { error: sessionError } = await supabase
    .from('composer_sessions')
    .update({
      tx_hash: settledTxHash,
      updated_at: nowIso(),
    })
    .eq('tx_hash', provisionalPaymentRef)

  if (sessionError) {
    throw new Error(`Failed to reconcile composer session settlement: ${sessionError.message}`)
  }

  const { data: consultations, error: consultationsError } = await supabase
    .from('consultations')
    .select('id, processing_trace')
    .eq('oracle_id', 'composer')
    .eq('tx_hash', provisionalPaymentRef)

  if (consultationsError) {
    throw new Error(`Failed to load composer consultations for settlement reconciliation: ${consultationsError.message}`)
  }

  for (const consultation of consultations ?? []) {
    const processingTrace = applyPaymentSettlementToTrace(
      env,
      (consultation.processing_trace as ProcessingTraceStep[] | null) ?? [],
      settledTxHash,
      'The x402 USDC payment settled before Composer generation was queued.',
    )

    const { error: updateError } = await supabase
      .from('consultations')
      .update({
        tx_hash: settledTxHash,
        processing_trace: processingTrace,
      })
      .eq('id', consultation.id)

    if (updateError) {
      throw new Error(`Failed to update composer consultation settlement metadata: ${updateError.message}`)
    }
  }
}
