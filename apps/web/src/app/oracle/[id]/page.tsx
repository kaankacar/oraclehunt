'use client'

import { useState, useEffect, type CSSProperties } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ORACLES,
  PERSONALITY_ORACLE_IDS,
  type OracleMeta,
  type Consultation,
  type OraclePersonality,
  type ProcessingTraceStep,
} from '@/types'
import { useWallet } from '@/components/WalletProvider'
import {
  consultOracle,
  ensureSmolAuth,
  pollComposerJob,
  resumeComposerJob,
  type ComposerAuthRequiredResult,
  type ComposerErrorResult,
  type ComposerPendingResult,
  type OracleConsultResponse,
  type OracleResult,
} from '@/lib/oracle-api'
import { getOracleHistory } from '@/lib/supabase'
import { ArtifactCard } from '@/components/ArtifactCard'
import { TraceTimeline } from '@/components/TraceTimeline'
import MidwayNav from '@/components/midway/MidwayNav'

const PUBLIC_TRACE_TEMPLATE: ProcessingTraceStep[] = [
  {
    id: 'client:payment-request',
    label: 'Preparing x402 Payment Request',
    status: 'pending',
    detail: 'Building the exact USDC payment payload for this oracle.',
  },
  {
    id: 'client:passkey-signature',
    label: 'Waiting for Passkey Signature',
    status: 'pending',
    detail: 'Passkey Kit is requesting WebAuthn confirmation from the browser.',
  },
  {
    id: 'client:request-dispatch',
    label: 'Submitting the Paid Oracle Request',
    status: 'pending',
    detail: 'The signed payment is being attached to the request and sent to the oracle worker.',
  },
  {
    id: 'client:oracle-processing',
    label: 'Oracle Processing',
    status: 'pending',
    detail: 'The worker is invoking the oracle model and preparing the artifact.',
  },
  {
    id: 'client:supabase-save',
    label: 'Saving to Codex',
    status: 'pending',
    detail: 'The finished artifact will be saved with payment and trace metadata.',
  },
  {
    id: 'payment-settled',
    label: 'Payment Settled on Stellar',
    status: 'pending',
    detail: 'The worker will attach the Stellar settlement hash after x402 confirmation.',
  },
  {
    id: 'oracle-generated',
    label: 'Oracle Generated Artifact',
    status: 'pending',
    detail: 'The oracle model will return the final artifact for this consultation.',
  },
  {
    id: 'artifact-saved',
    label: 'Saved to Codex',
    status: 'pending',
    detail: 'The consultation will appear in your Codex, Gallery, and Leaderboard.',
  },
]

const PERSONALITIES: Array<{ id: OraclePersonality; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'sassy', label: 'Sassy' },
  { id: 'slam_poet', label: 'Slam Poet' },
  { id: 'crypto_degen', label: 'Crypto Degen' },
]

export default function OraclePage() {
  const params = useParams()
  const oracleId = params['id'] as string
  const router = useRouter()

  const { address, isConnected, refreshBalance } = useWallet()
  const [oracle, setOracle] = useState<OracleMeta | null>(null)
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<OracleResult | null>(null)
  const [history, setHistory] = useState<Consultation[]>([])
  const [liveTrace, setLiveTrace] = useState<ProcessingTraceStep[]>([])
  const [personality, setPersonality] = useState<OraclePersonality>('default')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('Consulting…')
  const [error, setError] = useState('')

  useEffect(() => {
    const found = ORACLES.find((entry) => entry.id === oracleId)
    if (!found) router.push('/midway')
    else setOracle(found)
  }, [oracleId, router])

  useEffect(() => {
    if (oracleId !== 'informant' || !address) return
    getOracleHistory(address, 'informant').then((data) => setHistory(data as Consultation[]))
  }, [oracleId, address, result])

  if (!oracle) return null

  async function handleConsult() {
    if (!isConnected || !address) {
      router.push('/')
      return
    }
    if (!prompt.trim()) return

    setIsLoading(true)
    setError('')
    setResult(null)
    setLiveTrace(PUBLIC_TRACE_TEMPLATE)
    setLoadingLabel('Consulting…')

    try {
      const data = await consultOracle(oracleId, prompt, address, {
        personality,
        onProgress: (event) => {
          setLiveTrace((prev) => advancePublicTrace(prev, event))
        },
      })

      if (oracleId === 'composer') {
        const composerResult = await resolveComposerConsultation({
          initialResult: data,
          walletAddress: address,
          setLiveTrace,
          setLoadingLabel,
        })

        setLiveTrace(composerResult.processingTrace)
        setResult(composerResult)
        await refreshBalance()
        return
      }

      setLiveTrace((prev) => mergeTrace(prev, data.processingTrace))
      setResult(data as OracleResult)
      await refreshBalance()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The Oracle is silent. Try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const themedOracles = {
    seer: {
      rgb: '255, 45, 149',
      background: '/images/seerimage.png',
      icon: '/images/crystal_ball.png',
      iconAlt: 'Crystal ball',
    },
    painter: {
      rgb: '0, 229, 255',
      background: '/images/painter_background.png',
      icon: '/images/paintingicon.png',
      iconAlt: "Painter's palette",
    },
    composer: {
      rgb: '157, 78, 221',
      background: '/images/composerbackground.png',
      icon: '/images/musicicon.png',
      iconAlt: 'Composer note',
    },
    scribe: {
      rgb: '255, 179, 71',
      background: '/images/scribebackground.png',
      icon: '/images/scrollicon.png',
      iconAlt: 'Scroll',
    },
    scholar: {
      rgb: '74, 158, 255',
      background: '/images/scholarbackground.png',
      icon: '/images/bookicon.png',
      iconAlt: 'Book',
    },
    informant: {
      rgb: '57, 255, 20',
      background: '/images/informantbackground.png',
      icon: '/images/informanticon.png',
      iconAlt: 'Informant sigil',
    },
  } as const
  const themed = themedOracles[oracleId as keyof typeof themedOracles] ?? null

  const resultConsultation = result
    ? ({
        id: `latest:${result.timestamp}`,
        wallet_id: '',
        oracle_id: oracleId,
        prompt,
        artifact_text: result.artifact,
        artifact_image: result.artifactImage ?? null,
        audio_url_1: result.audioUrl1 ?? null,
        audio_url_2: result.audioUrl2 ?? null,
        tx_hash: result.txHash ?? null,
        processing_trace: liveTrace.length ? liveTrace : result.processingTrace,
        created_at: result.timestamp,
      } as Consultation)
    : null
  const showPersonalityControls = PERSONALITY_ORACLE_IDS.includes(oracleId as typeof PERSONALITY_ORACLE_IDS[number])
  const visibleTrace = liveTrace.length ? liveTrace : result?.processingTrace ?? PUBLIC_TRACE_TEMPLATE

  return (
    <div
      className="relative max-w-5xl mx-auto px-4 pt-24 pb-12"
      style={themed ? ({ '--theme-rgb': themed.rgb } as CSSProperties) : undefined}
    >
      {themed && (
        <>
          <div
            className="fixed inset-0 -z-10 bg-cover bg-center pointer-events-none"
            style={{ backgroundImage: `url('${themed.background}')` }}
          />
          <div className="fixed inset-0 -z-10 bg-black/50 pointer-events-none" />
        </>
      )}
      <MidwayNav backHref="/midway" backLabel="Back to the Midway" />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
        <div className={themed ? 'md:pl-16 lg:pl-24' : ''}>
          <div className="text-center mb-10">
            {themed ? (
              <img
                src={themed.icon}
                alt={themed.iconAlt}
                className="mx-auto mb-3 h-24 w-24 object-contain animate-oracle-orb"
              />
            ) : (
              <div className="text-5xl mb-3">{oracle.emoji}</div>
            )}
            <h1
              className={
                themed
                  ? 'font-title text-4xl md:text-5xl lg:text-6xl font-semibold tracking-[0.1em] text-white/90 mb-2'
                  : 'text-3xl font-bold text-navy mb-1'
              }
              style={
                themed
                  ? { textShadow: '0 2px 20px rgba(0,0,0,0.9), 0 0 40px rgba(var(--theme-rgb), 0.3)' }
                  : undefined
              }
            >
              {oracle.name}
            </h1>
            <p
              className={
                themed
                  ? 'font-title text-white/90 text-base md:text-lg tracking-[0.1em] mb-2'
                  : 'text-accent text-sm font-medium mb-2'
              }
            >
              {oracle.specialty}
            </p>
            <span
              className={
                themed
                  ? 'inline-block bg-black/40 border border-[rgba(var(--theme-rgb),0.35)] text-[rgba(var(--theme-rgb),0.95)] font-mono text-sm font-semibold px-3 py-1 rounded tracking-wider backdrop-blur-sm shadow-[0_0_14px_rgba(var(--theme-rgb),0.25)]'
                  : 'bg-light-blue text-accent font-mono text-sm font-semibold px-3 py-1 rounded'
              }
            >
              {oracle.fee} USDC per consultation
            </span>
          </div>

          {!result && (
            <div
              className={
                themed
                  ? 'relative rounded-2xl border border-[rgba(var(--theme-rgb),0.3)] bg-midnight/55 backdrop-blur-md p-6 shadow-[0_0_40px_rgba(var(--theme-rgb),0.18),inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_40px_rgba(var(--theme-rgb),0.08)]'
                  : 'bg-white rounded-2xl border border-accent/15 p-6 shadow-sm'
              }
            >
              <p
                className={
                  themed
                    ? 'text-chrome-bright/75 text-sm mb-4 italic font-body tracking-wide'
                    : 'text-navy/60 text-sm mb-4 italic'
                }
              >
                {oracle.description}
              </p>
              {showPersonalityControls && (
                <div className="mb-4">
                  <p
                    className={
                      themed
                        ? 'text-xs font-semibold uppercase tracking-[0.16em] text-chrome-dim/80 mb-2'
                        : 'text-xs font-semibold uppercase tracking-[0.16em] text-navy/45 mb-2'
                    }
                  >
                    Personality
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {PERSONALITIES.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setPersonality(option.id)}
                        className={
                          themed
                            ? `min-h-10 rounded-lg border px-3 text-xs font-medium transition-colors ${
                                personality === option.id
                                  ? 'border-[rgba(var(--theme-rgb),0.8)] bg-[rgba(var(--theme-rgb),0.85)] text-midnight shadow-[0_0_16px_rgba(var(--theme-rgb),0.35)]'
                                  : 'border-[rgba(var(--theme-rgb),0.2)] bg-black/25 text-chrome-bright/75 hover:border-[rgba(var(--theme-rgb),0.45)]'
                              }`
                            : `min-h-10 rounded-lg border px-3 text-xs font-medium transition-colors ${
                                personality === option.id
                                  ? 'border-accent bg-accent text-white'
                                  : 'border-accent/15 bg-light-blue/50 text-navy/65 hover:border-accent/35'
                              }`
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={getPlaceholder(oracleId)}
                rows={4}
                maxLength={1000}
                className={
                  themed
                    ? 'w-full rounded-lg px-4 py-3 text-sm resize-none mb-4 bg-black/40 border border-[rgba(var(--theme-rgb),0.25)] text-chrome-bright placeholder-chrome-dim/60 focus:outline-none focus:border-[rgba(var(--theme-rgb),0.6)] focus:shadow-[0_0_18px_rgba(var(--theme-rgb),0.35)] font-body transition-all'
                    : 'w-full border border-navy/20 rounded-lg px-4 py-3 text-sm text-navy placeholder-navy/30 resize-none focus:outline-none focus:border-accent mb-4'
                }
              />
              <div className="flex items-center justify-between">
                <span
                  className={
                    themed
                      ? 'text-xs text-chrome-dim/70 font-mono tracking-wider'
                      : 'text-xs text-navy/30 font-mono'
                  }
                >
                  {prompt.length}/1000
                </span>
                <button
                  onClick={handleConsult}
                  disabled={isLoading || !prompt.trim() || !isConnected}
                  className={
                    themed
                      ? 'bg-[rgba(var(--theme-rgb),0.8)] hover:bg-[rgb(var(--theme-rgb))] disabled:opacity-40 text-midnight font-semibold px-6 py-2.5 rounded-lg transition-all shadow-[0_0_20px_rgba(var(--theme-rgb),0.45)] hover:shadow-[0_0_28px_rgba(var(--theme-rgb),0.6)] tracking-wide'
                      : 'bg-accent hover:bg-accent-light disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors'
                  }
                >
                  {isLoading ? (oracleId === 'composer' ? loadingLabel : 'Consulting…') : `Pay ${oracle.fee} & Consult`}
                </button>
              </div>
              {error && (
                <p className={themed ? 'text-[rgba(var(--theme-rgb),0.9)] text-xs mt-3' : 'text-red-500 text-xs mt-3'}>
                  {error}
                </p>
              )}
              {!isConnected && (
                <p className={themed ? 'text-chrome-dim/80 text-xs mt-3' : 'text-navy/50 text-xs mt-3'}>
                  <Link
                    href="/"
                    className={
                      themed
                        ? 'text-[rgba(var(--theme-rgb),0.9)] underline hover:text-[rgb(var(--theme-rgb))]'
                        : 'text-accent underline'
                    }
                  >
                    Sign in
                  </Link>{' '}
                  to consult the Host.
                </p>
              )}
              {oracleId === 'composer' && isLoading && loadingLabel === 'Linking to Smol…' && (
                <p className={themed ? 'text-chrome-dim/80 text-xs mt-3' : 'text-navy/50 text-xs mt-3'}>
                  The Composer needs one more passkey assertion to link this wallet to Smol. This
                  should only happen once per active Smol session.
                </p>
              )}
            </div>
          )}

          {result && resultConsultation && (
            <div className="mt-6 space-y-5">
              <ArtifactCard consultation={resultConsultation} />
              <div className="text-center space-y-3">
                <p className={themed ? 'text-xs text-chrome-dim/80 font-body tracking-wider uppercase' : 'text-xs text-navy/50'}>
                  Saved to your Codex
                </p>
                <div className="flex gap-3 justify-center flex-wrap">
                  <button
                    onClick={() => {
                      setResult(null)
                      setPrompt('')
                      setLiveTrace([])
                      setError('')
                    }}
                    className={
                      themed
                        ? 'text-sm border border-[rgba(var(--theme-rgb),0.35)] text-[rgba(var(--theme-rgb),0.95)] px-4 py-2 rounded-lg hover:bg-[rgba(var(--theme-rgb),0.12)] hover:border-[rgba(var(--theme-rgb),0.6)] transition-all backdrop-blur-sm tracking-wide'
                        : 'text-sm border border-accent/30 text-accent px-4 py-2 rounded-lg hover:bg-light-blue transition-colors'
                    }
                  >
                    Ask Again
                  </button>
                  <Link
                    href="/midway"
                    className={
                      themed
                        ? 'text-sm bg-[rgba(var(--theme-rgb),0.8)] hover:bg-[rgb(var(--theme-rgb))] text-midnight font-semibold px-4 py-2 rounded-lg transition-all shadow-[0_0_18px_rgba(var(--theme-rgb),0.45)] hover:shadow-[0_0_26px_rgba(var(--theme-rgb),0.6)] tracking-wide'
                        : 'text-sm bg-accent text-white px-4 py-2 rounded-lg hover:bg-accent-light transition-colors'
                    }
                  >
                    More Hosts
                  </Link>
                  <Link
                    href={`/codex/${address}`}
                    className={
                      themed
                        ? 'text-sm border border-chrome-dim/30 text-chrome-bright/80 px-4 py-2 rounded-lg hover:bg-white/5 hover:border-chrome-dim/60 hover:text-chrome-bright transition-all backdrop-blur-sm tracking-wide'
                        : 'text-sm border border-navy/20 text-navy/60 px-4 py-2 rounded-lg hover:bg-light-blue transition-colors'
                    }
                  >
                    My Codex
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-20">
          <TraceTimeline
            steps={visibleTrace}
            title="Live execution trace"
            variant="compact"
            defaultExpanded={true}
          />

          {oracleId === 'informant' && (
            <div
              className={
                themed
                  ? 'rounded-2xl border border-[rgba(var(--theme-rgb),0.3)] bg-midnight/55 backdrop-blur-md p-5 shadow-[0_0_40px_rgba(var(--theme-rgb),0.18),inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_40px_rgba(var(--theme-rgb),0.08)]'
                  : 'bg-white rounded-2xl border border-accent/15 p-5 shadow-sm'
              }
            >
              <p
                className={
                  themed
                    ? 'text-xs font-semibold uppercase tracking-[0.2em] text-[rgba(var(--theme-rgb),0.9)] mb-3'
                    : 'text-xs font-semibold uppercase tracking-[0.2em] text-navy/45 mb-3'
                }
              >
                Previous Informant Answers
              </p>
              {history.length === 0 ? (
                <p className={themed ? 'text-sm text-chrome-dim/80 font-body' : 'text-sm text-navy/45'}>
                  Ask the Informant more than once. Previous riddles will stay here so clue patterns are visible.
                </p>
              ) : (
                <div className="space-y-4">
                  {history.map((entry) => (
                    <div
                      key={entry.id}
                      className={
                        themed
                          ? 'border-b last:border-b-0 border-[rgba(var(--theme-rgb),0.15)] pb-4 last:pb-0'
                          : 'border-b last:border-b-0 border-accent/10 pb-4 last:pb-0'
                      }
                    >
                      <p className={themed ? 'text-xs font-mono text-chrome-dim/60 mb-2 tracking-wider' : 'text-xs font-mono text-navy/35 mb-2'}>
                        {new Date(entry.created_at).toLocaleString()}
                      </p>
                      <p className={themed ? 'text-xs italic text-chrome-dim/80 whitespace-pre-wrap mb-2 font-body' : 'text-xs italic text-navy/45 whitespace-pre-wrap mb-2'}>
                        &ldquo;{entry.prompt}&rdquo;
                      </p>
                      <p className={themed ? 'text-sm text-chrome-bright whitespace-pre-wrap leading-relaxed font-body' : 'text-sm text-navy whitespace-pre-wrap leading-relaxed'}>
                        {entry.artifact_text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function isComposerPendingResult(
  result: OracleConsultResponse,
): result is ComposerPendingResult {
  return 'status' in result && result.status === 'pending'
}

function isComposerAuthRequiredResult(
  result: OracleConsultResponse,
): result is ComposerAuthRequiredResult {
  return 'status' in result && result.status === 'smol-auth-required'
}

function isComposerErrorResult(
  result: OracleConsultResponse,
): result is ComposerErrorResult {
  return 'status' in result && result.status === 'error'
}

async function resolveComposerConsultation({
  initialResult,
  walletAddress,
  setLiveTrace,
  setLoadingLabel,
}: {
  initialResult: OracleConsultResponse
  walletAddress: string
  setLiveTrace: (updater: ProcessingTraceStep[] | ((prev: ProcessingTraceStep[]) => ProcessingTraceStep[])) => void
  setLoadingLabel: (label: string) => void
}): Promise<OracleResult> {
  let current: OracleConsultResponse = initialResult

  while (isComposerAuthRequiredResult(current)) {
    setLiveTrace(current.processingTrace)
    setLoadingLabel('Linking to Smol…')
    await ensureSmolAuth(walletAddress)

    if (!current.txHash) {
      throw new Error('Composer payment hash missing after Smol auth was requested.')
    }

    current = await resumeComposerJob(walletAddress, current.txHash)
  }

  if (isComposerErrorResult(current)) {
    setLiveTrace(current.processingTrace)
    throw new Error(current.error)
  }

  if (isComposerPendingResult(current)) {
    setLiveTrace(current.processingTrace)
    setLoadingLabel('Composing… (up to 6 minutes)')

    while (isComposerPendingResult(current)) {
      await delay(5000)
      current = await pollComposerJob(current.jobId)

      if ('processingTrace' in current) {
        setLiveTrace(current.processingTrace)
      }

      if (isComposerErrorResult(current)) {
        throw new Error(current.error)
      }
    }
  }

  if ('status' in current) {
    throw new Error('Composer did not return a completed artifact.')
  }

  return current
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function advancePublicTrace(
  steps: ProcessingTraceStep[],
  event: string,
): ProcessingTraceStep[] {
  const next = steps.map((step) => ({ ...step }))
  const markSuccess = (id: string, detail?: string) => {
    const step = next.find((entry) => entry.id === id)
    if (!step) return
    step.status = 'success'
    if (detail) step.detail = detail
  }

  if (event === 'prepare-payment-request' || event === 'prepare-payment-transaction') {
    markSuccess('client:payment-request', 'The x402 client has priced the request and is assembling the USDC transfer.')
  }

  if (event === 'initialize-passkey-client' || event === 'await-passkey-signature') {
    markSuccess('client:payment-request')
    markSuccess('client:passkey-signature', 'Your browser is prompting for the existing passkey tied to this wallet.')
  }

  if (
    event === 'resimulate-signed-payment' ||
    event === 'payment-payload-ready' ||
    event === 'send-oracle-request'
  ) {
    markSuccess('client:payment-request')
    markSuccess('client:passkey-signature')
    markSuccess('client:request-dispatch', 'The signed payment payload is being re-simulated and attached to the paid oracle request.')
  }

  if (event === 'oracle-response-received') {
    markSuccess('client:oracle-processing', 'The worker returned the oracle artifact.')
    markSuccess('client:supabase-save', 'The artifact was saved with the final worker trace.')
  }

  return next
}

function mergeTrace(
  clientTrace: ProcessingTraceStep[],
  serverTrace: ProcessingTraceStep[],
): ProcessingTraceStep[] {
  const byId = new Map<string, ProcessingTraceStep>()
  for (const step of clientTrace) byId.set(step.id, step)
  for (const step of serverTrace) byId.set(step.id, step)

  return Array.from(byId.values())
}

function getPlaceholder(oracleId: string): string {
  const placeholders: Record<string, string> = {
    seer: "Describe yourself — your work, your passions, your year so far…",
    painter: "Describe a person or scene you'd like rendered in pixel art…",
    composer: "Name a theme for your song (e.g. 'late-night coding sessions')…",
    scribe: "Tell me anything. I will answer only in haiku.",
    scholar: "Ask Stella about Stellar, SDF, Soroban, Lumens, or the ecosystem…",
    informant: "Ask me anything. I speak only in riddles.",
  }
  return placeholders[oracleId] ?? 'Your message to the Host…'
}
