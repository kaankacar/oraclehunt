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

const FAL_MODEL = 'fal-ai/ace-step/prompt-to-audio'
const FAL_REQUEST_MODEL = 'fal-ai/ace-step'
const FAL_QUEUE_SUBMIT_URL = `https://queue.fal.run/${FAL_MODEL}`
const FAL_QUEUE_REQUEST_BASE = `https://queue.fal.run/${FAL_REQUEST_MODEL}`
const DEFAULT_DURATION_SECONDS = 60
const FAL_COST_PER_SECOND_USDC = 0.0002
const FAL_ESTIMATED_COST_USDC = Number((DEFAULT_DURATION_SECONDS * FAL_COST_PER_SECOND_USDC).toFixed(6))

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
  smol_job_id: string | null
  status: 'awaiting_auth' | 'queued' | 'processing' | 'complete' | 'error'
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
  smol_job_id: string | null
  tx_hash: string | null
  processing_trace: ProcessingTraceStep[] | null
  created_at: string
}

interface FalSubmitResponse {
  request_id?: string
  requestId?: string
  status_url?: string
  response_url?: string
  error?: string
  detail?: unknown
}

interface FalStatusResponse {
  status?: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ERROR' | string
  queue_position?: number
  logs?: Array<{ message?: string }>
  error?: string
  detail?: unknown
}

interface FalAudioFile {
  url?: string
  content_type?: string
  file_name?: string
}

interface FalAceResult {
  audio?: FalAudioFile
  seed?: number
  tags?: string
  lyrics?: string
}

function isConfirmedStellarTxHash(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{64}$/i.test(value))
}

function nowIso(): string {
  return new Date().toISOString()
}

function requireFalKey(env: Env): string {
  if (!env.FAL_KEY) {
    throw new Error('Composer fal.ai API key is not configured.')
  }
  return env.FAL_KEY
}

function buildComposerEconomics(env: Env) {
  const price = ORACLE_PRICE_USDC.composer

  return {
    payment_amount_usdc: price,
    estimated_model_cost_usdc: FAL_ESTIMATED_COST_USDC,
    estimated_profit_usdc: Number((price - FAL_ESTIMATED_COST_USDC).toFixed(6)),
    oracle_wallet_address: getOracleWalletAddress(env, 'composer'),
    ai_provider: 'fal.ai',
    ai_model: FAL_MODEL,
  }
}

function buildComposerTrace(
  env: Env,
  session: ComposerSessionRow,
  options?: {
    queued?: boolean
    inProgress?: boolean
    lyricsReady?: boolean
    audioReady?: boolean
    saved?: boolean
    errorMessage?: string
    queuePosition?: number
    logs?: string[]
  },
): ProcessingTraceStep[] {
  const paymentExplorerUrl = isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined
  const falRequestId = session.smol_job_id
  const lastLog = options?.logs?.filter(Boolean).slice(-1)[0]

  return [
    {
      id: 'payment-settled',
      label: 'Payment Settled on Stellar',
      status: 'success',
      detail: 'The x402 USDC payment settled before Composer generation was queued.',
      txHash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : undefined,
      links: paymentExplorerUrl ? [{ label: 'Open payment on Stellar Expert', url: paymentExplorerUrl }] : undefined,
    },
    {
      id: 'composer-job-queued',
      label: 'Queued Music Generation',
      status: options?.errorMessage ? 'error' : falRequestId || options?.queued || options?.inProgress || options?.saved ? 'success' : 'pending',
      detail: options?.errorMessage
        ? options.errorMessage
        : falRequestId
          ? `fal.ai accepted the ${FAL_MODEL} request ${falRequestId}.`
          : 'Composer is submitting the music request to fal.ai.',
    },
    {
      id: 'composer-generation',
      label: 'Generating Song with Lyrics',
      status: options?.errorMessage ? 'error' : options?.inProgress || options?.lyricsReady || options?.audioReady || options?.saved ? 'success' : 'pending',
      detail: options?.errorMessage
        ? options.errorMessage
        : options?.inProgress
          ? lastLog ?? 'fal.ai is generating the song.'
          : typeof options?.queuePosition === 'number'
            ? `The job is waiting in the fal.ai queue at position ${options.queuePosition}.`
            : 'The song is waiting for a fal.ai runner.',
    },
    {
      id: 'composer-lyrics',
      label: 'Lyrics Prepared',
      status: options?.errorMessage ? 'error' : options?.lyricsReady || options?.saved ? 'success' : 'pending',
      detail: options?.errorMessage
        ? options.errorMessage
        : options?.lyricsReady || options?.saved
          ? 'The generated lyrics were returned with the song.'
          : 'ACE-Step will generate lyrics from the prompt.',
    },
    {
      id: 'composer-audio',
      label: 'Audio Ready',
      status: options?.errorMessage ? 'error' : options?.audioReady || options?.saved ? 'success' : 'pending',
      detail: options?.errorMessage
        ? options.errorMessage
        : options?.audioReady || options?.saved
          ? 'fal.ai returned a hosted audio file for playback.'
          : 'The audio file will appear here when generation completes.',
    },
    {
      id: 'composer-saved',
      label: 'Saved to Codex',
      status: options?.errorMessage ? 'error' : options?.saved ? 'success' : 'pending',
      detail: options?.errorMessage
        ? options.errorMessage
        : options?.saved
          ? 'The completed song was written to Supabase and is now visible in Codex and Gallery.'
          : 'The Composer will save the artifact as soon as the song is ready.',
    },
  ]
}

function buildComposerArtifactText(prompt: string, result: FalAceResult): string {
  const parts = [`Original song generated for:\n${prompt}`]

  if (result.tags) {
    parts.push(`Tags: ${result.tags}`)
  }

  if (result.lyrics) {
    parts.push(`Lyrics:\n${result.lyrics}`)
  }

  if (typeof result.seed === 'number') {
    parts.push(`Seed: ${result.seed}`)
  }

  return parts.join('\n\n')
}

async function readResponseJson<T>(response: Response): Promise<T> {
  const body = await response.text()
  let json: unknown = {}

  if (body) {
    try {
      json = JSON.parse(body)
    } catch {
      json = { error: body }
    }
  }

  if (!response.ok) {
    const message =
      typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error
        : typeof (json as { detail?: unknown }).detail === 'string'
          ? (json as { detail: string }).detail
          : body || `HTTP ${response.status}`
    throw new Error(message)
  }

  return json as T
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

async function getComposerSessionByTxHash(env: Env, txHash: string): Promise<ComposerSessionRow | null> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase
    .from('composer_sessions')
    .select('id, wallet_id, stellar_address, tx_hash, prompt, smol_job_id, status, error_message, created_at, completed_at')
    .eq('tx_hash', txHash)
    .maybeSingle()

  if (error) throw new Error(`Failed to load composer session: ${error.message}`)
  return (data as ComposerSessionRow | null) ?? null
}

async function getComposerSessionByIdOrProviderJobId(env: Env, id: string): Promise<ComposerSessionRow | null> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)

  const { data: byId, error: byIdError } = await supabase
    .from('composer_sessions')
    .select('id, wallet_id, stellar_address, tx_hash, prompt, smol_job_id, status, error_message, created_at, completed_at')
    .eq('id', id)
    .maybeSingle()

  if (byIdError) throw new Error(`Failed to load composer session: ${byIdError.message}`)
  if (byId) return byId as ComposerSessionRow

  const { data: byJobId, error: byJobIdError } = await supabase
    .from('composer_sessions')
    .select('id, wallet_id, stellar_address, tx_hash, prompt, smol_job_id, status, error_message, created_at, completed_at')
    .eq('smol_job_id', id)
    .maybeSingle()

  if (byJobIdError) throw new Error(`Failed to load composer session: ${byJobIdError.message}`)
  return (byJobId as ComposerSessionRow | null) ?? null
}

async function createOrLoadComposerSession(
  env: Env,
  wallet: WalletRow,
  prompt: string,
  txHash: string,
): Promise<{ session: ComposerSessionRow; created: boolean }> {
  const existing = await getComposerSessionByTxHash(env, txHash)
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
    .select('id, wallet_id, stellar_address, tx_hash, prompt, smol_job_id, status, error_message, created_at, completed_at')
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

async function findCompletedComposerConsultation(env: Env, session: ComposerSessionRow): Promise<ConsultationRow | null> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)

  const { data: bySessionId, error: bySessionIdError } = await supabase
    .from('consultations')
    .select('id, wallet_id, prompt, artifact_text, artifact_image, audio_url_1, audio_url_2, smol_job_id, tx_hash, processing_trace, created_at')
    .eq('composer_session_id', session.id)
    .maybeSingle()

  if (bySessionIdError) {
    throw new Error(`Failed to load composer consultation: ${bySessionIdError.message}`)
  }
  if (bySessionId) return bySessionId as ConsultationRow

  if (!session.smol_job_id) return null

  const { data: byProviderJobId, error: byProviderJobIdError } = await supabase
    .from('consultations')
    .select('id, wallet_id, prompt, artifact_text, artifact_image, audio_url_1, audio_url_2, smol_job_id, tx_hash, processing_trace, created_at')
    .eq('smol_job_id', session.smol_job_id)
    .maybeSingle()

  if (byProviderJobIdError) {
    throw new Error(`Failed to load composer consultation: ${byProviderJobIdError.message}`)
  }

  return (byProviderJobId as ConsultationRow | null) ?? null
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

async function submitFalComposerJob(env: Env, prompt: string): Promise<string> {
  const response = await fetch(FAL_QUEUE_SUBMIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Key ${requireFalKey(env)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      instrumental: false,
      duration: DEFAULT_DURATION_SECONDS,
    }),
  })

  const json = await readResponseJson<FalSubmitResponse>(response)
  const requestId = json.request_id ?? json.requestId
  if (!requestId) {
    throw new Error('fal.ai did not return a request id.')
  }

  return requestId
}

async function fetchFalStatus(env: Env, requestId: string): Promise<FalStatusResponse> {
  const response = await fetch(`${FAL_QUEUE_REQUEST_BASE}/requests/${encodeURIComponent(requestId)}/status?logs=1`, {
    headers: { Authorization: `Key ${requireFalKey(env)}` },
  })

  return readResponseJson<FalStatusResponse>(response)
}

async function fetchFalResult(env: Env, requestId: string): Promise<FalAceResult> {
  const response = await fetch(`${FAL_QUEUE_REQUEST_BASE}/requests/${encodeURIComponent(requestId)}`, {
    headers: { Authorization: `Key ${requireFalKey(env)}` },
  })
  const json = await readResponseJson<{ response?: FalAceResult; data?: FalAceResult } & FalAceResult>(response)
  return json.response ?? json.data ?? json
}

async function finalizeComposerConsultation(
  env: Env,
  session: ComposerSessionRow,
  result: FalAceResult,
): Promise<OracleResponse> {
  if (!session.smol_job_id) {
    throw new Error('Composer session is missing a fal.ai request id.')
  }
  if (!result.audio?.url) {
    throw new Error('fal.ai completed without returning an audio URL.')
  }

  const existing = await findCompletedComposerConsultation(env, session)
  if (existing) {
    return completedResponseFromRow(env, existing)
  }

  const processingTrace = buildComposerTrace(env, session, {
    lyricsReady: Boolean(result.lyrics),
    audioReady: true,
    saved: true,
  })
  const artifact = buildComposerArtifactText(session.prompt, result)
  const timestamp = nowIso()

  const consultationPayload = {
    wallet_id: session.wallet_id,
    oracle_id: 'composer',
    prompt: session.prompt,
    artifact_text: artifact,
    artifact_image: null,
    audio_url_1: result.audio.url,
    audio_url_2: null,
    composer_session_id: session.id,
    smol_job_id: session.smol_job_id,
    tx_hash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : null,
    processing_trace: processingTrace,
    ...buildComposerEconomics(env),
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { error: insertError } = await supabase
    .from('consultations')
    .insert(consultationPayload)

  if (insertError) {
    throw new Error(`Failed to insert composer consultation: ${insertError.message}`)
  }

  await updateComposerSession(env, session.id, {
    status: 'complete',
    completed_at: timestamp,
    error_message: null,
  })

  return {
    artifact,
    artifactImage: undefined,
    audioUrl1: result.audio.url,
    audioUrl2: null,
    oracleId: 'composer',
    txHash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : undefined,
    explorerUrl: isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined,
    processingTrace,
    timestamp,
  }
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

  if (created || !session.smol_job_id) {
    try {
      const requestId = await submitFalComposerJob(env, session.prompt)
      await updateComposerSession(env, session.id, {
        smol_job_id: requestId,
        status: 'queued',
        error_message: null,
      })

      return pollComposerStatus(session.id, env)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Composer generation failed.'
      await updateComposerSession(env, session.id, {
        status: 'error',
        error_message: message,
      })
      return composerErrorResponse(env, session, message)
    }
  }

  return pollComposerStatus(session.id, env)
}

export async function resumeComposerOracle(
  walletAddress: string,
  txHash: string,
  env: Env,
): Promise<ComposerPendingResponse | ComposerErrorResponse | OracleResponse> {
  const wallet = await getWalletForComposer(env, walletAddress)
  const session = await getComposerSessionByTxHash(env, txHash)

  if (!session || session.wallet_id !== wallet.id) {
    throw new Error('Composer session not found for this wallet and payment.')
  }

  return pollComposerStatus(session.id, env)
}

function composerErrorResponse(env: Env, session: ComposerSessionRow, message: string): ComposerErrorResponse {
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

export async function pollComposerStatus(
  jobId: string,
  env: Env,
): Promise<ComposerPendingResponse | OracleResponse | ComposerErrorResponse> {
  const session = await getComposerSessionByIdOrProviderJobId(env, jobId)
  if (!session) {
    return {
      status: 'error',
      oracleId: 'composer',
      error: 'Composer session not found.',
      processingTrace: [],
      timestamp: nowIso(),
    }
  }

  const existing = await findCompletedComposerConsultation(env, session)
  if (existing) {
    return completedResponseFromRow(env, existing)
  }

  if (session.status === 'error') {
    return composerErrorResponse(env, session, session.error_message ?? 'Composer generation failed.')
  }

  if (!session.smol_job_id) {
    return {
      status: 'pending',
      oracleId: 'composer',
      jobId: session.id,
      txHash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : undefined,
      explorerUrl: isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined,
      processingTrace: buildComposerTrace(env, session, { queued: true }),
      timestamp: nowIso(),
    }
  }

  try {
    const status = await fetchFalStatus(env, session.smol_job_id)
    const logs = status.logs?.map((log) => log.message ?? '').filter(Boolean)

    if (status.status === 'COMPLETED') {
      const result = await fetchFalResult(env, session.smol_job_id)
      return finalizeComposerConsultation(env, session, result)
    }

    if (status.status === 'FAILED' || status.status === 'ERROR') {
      const message = status.error ?? (typeof status.detail === 'string' ? status.detail : 'fal.ai reported that the Composer job failed.')
      await updateComposerSession(env, session.id, {
        status: 'error',
        error_message: message,
      })
      return composerErrorResponse(env, session, message)
    }

    if (status.status === 'IN_PROGRESS' && session.status !== 'processing') {
      await updateComposerSession(env, session.id, {
        status: 'processing',
        error_message: null,
      })
    }

    return {
      status: 'pending',
      oracleId: 'composer',
      jobId: session.id,
      txHash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : undefined,
      explorerUrl: isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined,
      processingTrace: buildComposerTrace(env, session, {
        queued: status.status === 'IN_QUEUE',
        inProgress: status.status === 'IN_PROGRESS',
        queuePosition: status.queue_position,
        logs,
      }),
      timestamp: nowIso(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Composer status check failed.'
    await updateComposerSession(env, session.id, {
      status: 'error',
      error_message: message,
    })
    return composerErrorResponse(env, session, message)
  }
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
