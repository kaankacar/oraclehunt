import { createClient } from '@supabase/supabase-js'
import { getTxExplorerUrl } from '../stellar'
import { applyPaymentSettlementToTrace } from './handler'
import type {
  ComposerAuthRequiredResponse,
  ComposerErrorResponse,
  ComposerPendingResponse,
  Env,
  OracleRequest,
  OracleResponse,
  ProcessingTraceStep,
} from '../types'

const DEFAULT_SMOL_URL = 'https://api.smol.xyz'

interface WalletRow {
  id: string
  stellar_address: string
  smol_jwt: string | null
  smol_jwt_expires_at: string | null
}

interface ComposerSessionRow {
  id: string
  wallet_id: string
  stellar_address: string
  tx_hash: string
  prompt: string
  smol_job_id: string | null
  status: 'awaiting_auth' | 'queued' | 'complete' | 'error'
  error_message: string | null
  created_at: string
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

interface SmolLyrics {
  title?: string
  lyrics?: string
  style?: string[]
}

interface SmolSong {
  music_id: string
  status: number
  audio?: string
}

interface SmolJobPayload {
  kv_do?: {
    image?: boolean
    lyrics?: SmolLyrics
    songs?: SmolSong[]
  }
  d1?: {
    Id?: string
  }
  wf?: {
    status?: string
  } | string | null
}

function isConfirmedStellarTxHash(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{64}$/i.test(value))
}

function getSmolBaseUrl(env: Env): string {
  return (env.SMOL_API_URL ?? DEFAULT_SMOL_URL).replace(/\/+$/, '')
}

function getSmolApiBase(env: Env): string {
  return getSmolBaseUrl(env)
}

function getSmolImageUrl(env: Env, jobId: string): string {
  return `${getSmolApiBase(env)}/image/${jobId}.png`
}

function getSmolSongUrl(env: Env, musicId: string): string {
  return `${getSmolApiBase(env)}/song/${musicId}.mp3`
}

function getReadySongUrl(env: Env, song: SmolSong): string {
  return song.status < 4 && song.audio ? song.audio : getSmolSongUrl(env, song.music_id)
}

function nowIso(): string {
  return new Date().toISOString()
}

function hasUsableSmolJwt(wallet: WalletRow): boolean {
  if (!wallet.smol_jwt || !wallet.smol_jwt_expires_at) return false
  return new Date(wallet.smol_jwt_expires_at).getTime() > Date.now()
}

function buildComposerAuthRequiredTrace(env: Env, txHash?: string): ProcessingTraceStep[] {
  const explorerUrl = isConfirmedStellarTxHash(txHash) ? getTxExplorerUrl(env, txHash) : undefined

  return [
    {
      id: 'payment-settled',
      label: 'Payment Settled on Stellar',
      status: 'success',
      detail: isConfirmedStellarTxHash(txHash)
        ? 'The x402 USDC payment was confirmed before the Composer began.'
        : 'Composer payment was accepted. The worker is carrying an internal payment reference until settlement metadata is available.',
      txHash: isConfirmedStellarTxHash(txHash) ? txHash : undefined,
      links: explorerUrl ? [{ label: 'Open payment on Stellar Expert', url: explorerUrl }] : undefined,
    },
    {
      id: 'smol-auth-link',
      label: 'Linking Identity to Smol',
      status: 'pending',
      detail: 'The Composer needs one more passkey assertion to mint a 30-day Smol session for this wallet.',
    },
  ]
}

function buildComposerTrace(
  env: Env,
  session: ComposerSessionRow,
  options?: {
    coverReady?: boolean
    lyricsReady?: boolean
    songs?: SmolSong[]
    saved?: boolean
    errorMessage?: string
  },
): ProcessingTraceStep[] {
  const paymentExplorerUrl = isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined
  const songs = options?.songs ?? []
  const songsReady = songs.length >= 2 && songs.every((song) => song.status >= 4)
  const anySongsStarted = songs.some((song) => Boolean(song.audio) || song.status > 0)

  const trace: ProcessingTraceStep[] = [
    {
      id: 'payment-settled',
      label: 'Payment Settled on Stellar',
      status: 'success',
      detail: 'The x402 USDC payment settled before the Smol workflow began.',
      txHash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : undefined,
      links: paymentExplorerUrl ? [{ label: 'Open payment on Stellar Expert', url: paymentExplorerUrl }] : undefined,
    },
    {
      id: 'smol-auth-linked',
      label: 'Smol Identity Linked',
      status: 'success',
      detail: 'A valid Smol JWT was found for this wallet, so the Composer could use the linked identity immediately.',
    },
    {
      id: 'smol-job-queued',
      label: 'Queued Song Generation on Smol',
      status: 'success',
      detail: session.smol_job_id
        ? `Smol accepted the job and issued workflow ${session.smol_job_id}.`
        : 'The Composer is waiting for Smol to issue a workflow id.',
    },
    {
      id: 'composer-cover-art',
      label: 'Generating Cover Art via Pixellab',
      status: options?.coverReady ? 'success' : 'pending',
      detail: options?.coverReady
        ? 'Smol finished the pixel-art cover.'
        : 'The image pipeline is still rendering the cover art.',
    },
    {
      id: 'composer-lyrics',
      label: 'Lyrics Composed',
      status: options?.lyricsReady ? 'success' : 'pending',
      detail: options?.lyricsReady
        ? 'Smol finalized the title, tags, and lyrics.'
        : 'The lyric-writing stage is still running.',
    },
    {
      id: 'composer-audio',
      label: 'Rendering Audio Variations',
      status: songsReady ? 'success' : 'pending',
      detail: songsReady
        ? 'Both audio variations were rendered and finalized.'
        : anySongsStarted
          ? 'Audio rendering has started and the tracks are still baking.'
          : 'The audio generator has not started streaming yet.',
    },
    {
      id: 'composer-saved',
      label: 'Saved to Codex',
      status: options?.errorMessage ? 'error' : options?.saved ? 'success' : 'pending',
      detail: options?.errorMessage
        ? options.errorMessage
        : options?.saved
          ? 'The completed song was written to Supabase and is now visible in Codex and Gallery.'
          : 'The Composer will save the artifact as soon as both songs are ready.',
    },
  ]

  return trace
}

function buildComposerArtifactText(lyrics?: SmolLyrics): string {
  if (!lyrics) return ''

  const parts: string[] = []
  if (lyrics.title) parts.push(`Title: ${lyrics.title}`)
  if (lyrics.style?.length) parts.push(`Tags: ${lyrics.style.join(', ')}`)
  if (lyrics.lyrics) {
    if (parts.length) parts.push('')
    parts.push(lyrics.lyrics)
  }

  return parts.join('\n')
}

async function getWalletForComposer(env: Env, walletAddress: string): Promise<WalletRow> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase
    .from('wallets')
    .select('id, stellar_address, smol_jwt, smol_jwt_expires_at')
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
    .select('id, wallet_id, stellar_address, tx_hash, prompt, smol_job_id, status, error_message, created_at')
    .eq('tx_hash', txHash)
    .maybeSingle()

  if (error) throw new Error(`Failed to load composer session: ${error.message}`)
  return (data as ComposerSessionRow | null) ?? null
}

async function getComposerSessionByJobId(env: Env, jobId: string): Promise<ComposerSessionRow | null> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase
    .from('composer_sessions')
    .select('id, wallet_id, stellar_address, tx_hash, prompt, smol_job_id, status, error_message, created_at')
    .eq('smol_job_id', jobId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load composer session: ${error.message}`)
  return (data as ComposerSessionRow | null) ?? null
}

async function createOrLoadComposerSession(
  env: Env,
  wallet: WalletRow,
  prompt: string,
  txHash: string,
): Promise<ComposerSessionRow> {
  const existing = await getComposerSessionByTxHash(env, txHash)
  if (existing) {
    if (existing.stellar_address !== wallet.stellar_address) {
      throw new Error('Composer session belongs to a different wallet.')
    }
    return existing
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase
    .from('composer_sessions')
    .insert({
      wallet_id: wallet.id,
      stellar_address: wallet.stellar_address,
      tx_hash: txHash,
      prompt,
      status: 'awaiting_auth',
    })
    .select('id, wallet_id, stellar_address, tx_hash, prompt, smol_job_id, status, error_message, created_at')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create composer session: ${error?.message ?? 'unknown error'}`)
  }

  return data as ComposerSessionRow
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

async function findCompletedComposerConsultation(env: Env, jobId: string): Promise<ConsultationRow | null> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase
    .from('consultations')
    .select('id, wallet_id, prompt, artifact_text, artifact_image, audio_url_1, audio_url_2, smol_job_id, tx_hash, processing_trace, created_at')
    .eq('smol_job_id', jobId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load composer consultation: ${error.message}`)
  return (data as ConsultationRow | null) ?? null
}

async function startSmolJob(env: Env, prompt: string, jwt: string): Promise<string> {
  const response = await fetch(`${getSmolApiBase(env)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      public: true,
      instrumental: false,
    }),
  })

  const body = await response.text()
  if (!response.ok) {
    throw new Error(body || `Smol job creation failed with HTTP ${response.status}`)
  }

  return body.trim()
}

async function fetchSmolJob(env: Env, jobId: string, jwt: string): Promise<SmolJobPayload> {
  const response = await fetch(`${getSmolApiBase(env)}/${jobId}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  })

  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = (json as { error?: string; message?: string }).error
      ?? (json as { error?: string; message?: string }).message
      ?? `Smol status request failed with HTTP ${response.status}`
    throw new Error(message)
  }

  return json as SmolJobPayload
}

function isSmolWorkflowErrored(payload: SmolJobPayload): boolean {
  if (!payload.wf) return false
  if (typeof payload.wf === 'string') return payload.wf === 'errored'
  return payload.wf.status === 'errored'
}

function isSmolWorkflowComplete(payload: SmolJobPayload): boolean {
  if (payload.d1?.Id) return true
  if (!payload.wf) return false
  if (typeof payload.wf === 'string') return payload.wf === 'complete'
  return payload.wf.status === 'complete'
}

async function finalizeComposerConsultation(
  env: Env,
  session: ComposerSessionRow,
  payload: SmolJobPayload,
): Promise<OracleResponse> {
  if (!session.smol_job_id) {
    throw new Error('Composer session is missing a Smol job id.')
  }

  const existing = await findCompletedComposerConsultation(env, session.smol_job_id)
  if (existing) {
    const trace = existing.processing_trace ?? buildComposerTrace(env, session, { saved: true })
    return {
      artifact: existing.artifact_text,
      artifactImage: existing.artifact_image ?? undefined,
      audioUrl1: existing.audio_url_1 ?? null,
      audioUrl2: existing.audio_url_2 ?? null,
      oracleId: 'composer',
      txHash: isConfirmedStellarTxHash(existing.tx_hash) ? existing.tx_hash : undefined,
      explorerUrl: isConfirmedStellarTxHash(existing.tx_hash) ? getTxExplorerUrl(env, existing.tx_hash) : undefined,
      processingTrace: trace,
      timestamp: existing.created_at,
    }
  }

  const lyrics = payload.kv_do?.lyrics
  const songs = payload.kv_do?.songs ?? []
  const readySongs = songs.filter((song) => song.status >= 4).slice(0, 2)

  if (!lyrics?.lyrics || readySongs.length < 2) {
    throw new Error('Composer job completed without enough lyrics or audio to finalize the artifact.')
  }

  const processingTrace = buildComposerTrace(env, session, {
    coverReady: Boolean(payload.kv_do?.image),
    lyricsReady: true,
    songs,
    saved: true,
  })

  const artifactImage = getSmolImageUrl(env, session.smol_job_id)
  const audioUrl1 = getReadySongUrl(env, readySongs[0]!)
  const audioUrl2 = getReadySongUrl(env, readySongs[1]!)
  const artifact = buildComposerArtifactText(lyrics)
  const timestamp = nowIso()
  const consultationPayload = {
    wallet_id: session.wallet_id,
    oracle_id: 'composer',
    prompt: session.prompt,
    artifact_text: artifact,
    artifact_image: artifactImage,
    audio_url_1: audioUrl1,
    audio_url_2: audioUrl2,
    smol_job_id: session.smol_job_id,
    tx_hash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : null,
    processing_trace: processingTrace,
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
  const { data: persisted, error: persistedLookupError } = await supabase
    .from('consultations')
    .select('id')
    .eq('smol_job_id', session.smol_job_id)
    .maybeSingle()

  if (persistedLookupError) {
    throw new Error(`Failed to check existing composer consultation: ${persistedLookupError.message}`)
  }

  if (persisted?.id) {
    const { error: updateError } = await supabase
      .from('consultations')
      .update(consultationPayload)
      .eq('id', persisted.id)

    if (updateError) {
      throw new Error(`Failed to update composer consultation: ${updateError.message}`)
    }
  } else {
    const { error: insertError } = await supabase
      .from('consultations')
      .insert(consultationPayload)

    if (insertError) {
      throw new Error(`Failed to insert composer consultation: ${insertError.message}`)
    }
  }

  await updateComposerSession(env, session.id, {
    status: 'complete',
    completed_at: timestamp,
    error_message: null,
  })

  return {
    artifact,
    artifactImage,
    audioUrl1,
    audioUrl2,
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
): Promise<ComposerPendingResponse | ComposerAuthRequiredResponse | ComposerErrorResponse | OracleResponse> {
  if (!txHash) {
    throw new Error('Composer requires a verified payment reference.')
  }

  const wallet = await getWalletForComposer(env, req.walletAddress)
  const session = await createOrLoadComposerSession(env, wallet, req.prompt, txHash)

  if (!hasUsableSmolJwt(wallet)) {
    return {
      status: 'smol-auth-required',
      oracleId: 'composer',
      txHash,
      explorerUrl: isConfirmedStellarTxHash(txHash) ? getTxExplorerUrl(env, txHash) : undefined,
      processingTrace: buildComposerAuthRequiredTrace(env, txHash),
      timestamp: nowIso(),
    }
  }

  return resumeComposerOracle(req.walletAddress, txHash, env)
}

export async function resumeComposerOracle(
  walletAddress: string,
  txHash: string,
  env: Env,
): Promise<ComposerPendingResponse | ComposerAuthRequiredResponse | ComposerErrorResponse | OracleResponse> {
  const wallet = await getWalletForComposer(env, walletAddress)
  const session = await getComposerSessionByTxHash(env, txHash)

  if (!session || session.wallet_id !== wallet.id) {
    throw new Error('Composer session not found for this wallet and payment.')
  }

  if (!hasUsableSmolJwt(wallet)) {
    return {
      status: 'smol-auth-required',
      oracleId: 'composer',
      txHash,
      explorerUrl: isConfirmedStellarTxHash(txHash) ? getTxExplorerUrl(env, txHash) : undefined,
      processingTrace: buildComposerAuthRequiredTrace(env, txHash),
      timestamp: nowIso(),
    }
  }

  if (session.smol_job_id) {
    return pollComposerStatus(session.smol_job_id, env)
  }

  const jobId = await startSmolJob(env, session.prompt, wallet.smol_jwt!)
  await updateComposerSession(env, session.id, {
    smol_job_id: jobId,
    status: 'queued',
    error_message: null,
  })

  const updatedSession: ComposerSessionRow = {
    ...session,
    smol_job_id: jobId,
    status: 'queued',
  }

  return {
    status: 'pending',
    oracleId: 'composer',
    jobId,
    txHash: session.tx_hash,
    explorerUrl: isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined,
    processingTrace: buildComposerTrace(env, updatedSession),
    timestamp: nowIso(),
  }
}

export async function pollComposerStatus(
  jobId: string,
  env: Env,
): Promise<ComposerPendingResponse | OracleResponse | ComposerErrorResponse> {
  const session = await getComposerSessionByJobId(env, jobId)
  if (!session) {
    return {
      status: 'error',
      oracleId: 'composer',
      error: 'Composer session not found.',
      processingTrace: [],
      timestamp: nowIso(),
    }
  }

  const existing = await findCompletedComposerConsultation(env, jobId)
  if (existing) {
    const trace = existing.processing_trace ?? buildComposerTrace(env, session, { saved: true })
    return {
      artifact: existing.artifact_text,
      artifactImage: existing.artifact_image ?? undefined,
      audioUrl1: existing.audio_url_1 ?? null,
      audioUrl2: existing.audio_url_2 ?? null,
      oracleId: 'composer',
      txHash: isConfirmedStellarTxHash(existing.tx_hash) ? existing.tx_hash : undefined,
      explorerUrl: isConfirmedStellarTxHash(existing.tx_hash) ? getTxExplorerUrl(env, existing.tx_hash) : undefined,
      processingTrace: trace,
      timestamp: existing.created_at,
    }
  }

  const wallet = await getWalletForComposer(env, session.stellar_address)
  if (!wallet.smol_jwt) {
    const processingTrace = buildComposerTrace(env, session, {
      errorMessage: 'The Composer session lost its Smol credentials before the song finished.',
    })
    await updateComposerSession(env, session.id, {
      status: 'error',
      error_message: 'Missing Smol JWT while polling composer status.',
    })

    return {
      status: 'error',
      oracleId: 'composer',
      error: 'The Composer session needs to be linked to Smol again.',
      txHash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : undefined,
      explorerUrl: isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined,
      processingTrace,
      timestamp: nowIso(),
    }
  }

  try {
    const payload = await fetchSmolJob(env, jobId, wallet.smol_jwt)

    if (isSmolWorkflowErrored(payload)) {
      const processingTrace = buildComposerTrace(env, session, {
        coverReady: Boolean(payload.kv_do?.image),
        lyricsReady: Boolean(payload.kv_do?.lyrics?.lyrics),
        songs: payload.kv_do?.songs ?? [],
        errorMessage: 'Smol reported that the workflow errored before the song could finish.',
      })
      await updateComposerSession(env, session.id, {
        status: 'error',
        error_message: 'Smol workflow errored.',
      })

      return {
        status: 'error',
        oracleId: 'composer',
        error: 'The Composer workflow errored before the song finished.',
        txHash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : undefined,
        explorerUrl: isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined,
        processingTrace,
        timestamp: nowIso(),
      }
    }

    if (isSmolWorkflowComplete(payload)) {
      return finalizeComposerConsultation(env, session, payload)
    }

    return {
      status: 'pending',
      oracleId: 'composer',
      jobId,
      txHash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : undefined,
      explorerUrl: isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined,
      processingTrace: buildComposerTrace(env, session, {
        coverReady: Boolean(payload.kv_do?.image),
        lyricsReady: Boolean(payload.kv_do?.lyrics?.lyrics),
        songs: payload.kv_do?.songs ?? [],
      }),
      timestamp: nowIso(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Composer status check failed.'
    const processingTrace = buildComposerTrace(env, session, {
      errorMessage: message,
    })
    await updateComposerSession(env, session.id, {
      status: 'error',
      error_message: message,
    })

    return {
      status: 'error',
      oracleId: 'composer',
      error: message,
      txHash: isConfirmedStellarTxHash(session.tx_hash) ? session.tx_hash : undefined,
      explorerUrl: isConfirmedStellarTxHash(session.tx_hash) ? getTxExplorerUrl(env, session.tx_hash) : undefined,
      processingTrace,
      timestamp: nowIso(),
    }
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
      'The x402 USDC payment settled before the Smol workflow began.',
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
