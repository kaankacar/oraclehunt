'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ORACLES, type OracleMeta, type Consultation, type ProcessingTraceStep } from '@/types'
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

  const oracleAscii: Record<string, string> = {
    seer: '✦ ✦ ✦  👁  ✦ ✦ ✦',
    painter: '▓▒░ 🎨 ░▒▓',
    composer: '♩ ♪ ♫ 🎵 ♫ ♪ ♩',
    scribe: '— 📜 —',
    scholar: '⌗ 📚 ⌗',
    informant: '// 🕵️ //',
  }

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

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <Link href="/midway" className="text-accent/70 hover:text-accent text-sm mb-8 inline-block transition-colors">
        ← Back to the Midway
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
        <div>
          <div className="text-center mb-10">
            <p className="font-mono text-navy/40 text-sm mb-4 tracking-widest">
              {oracleAscii[oracleId] ?? oracle.emoji}
            </p>
            <div className="text-5xl mb-3">{oracle.emoji}</div>
            <h1 className="text-3xl font-bold text-navy mb-1">{oracle.name}</h1>
            <p className="text-accent text-sm font-medium mb-2">{oracle.specialty}</p>
            <span className="bg-light-blue text-accent font-mono text-sm font-semibold px-3 py-1 rounded">
              {oracle.fee} USDC per consultation
            </span>
          </div>

          {!result && (
            <div className="bg-white rounded-2xl border border-accent/15 p-6 shadow-sm">
              <p className="text-navy/60 text-sm mb-4 italic">{oracle.description}</p>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={getPlaceholder(oracleId)}
                rows={4}
                maxLength={1000}
                className="w-full border border-navy/20 rounded-lg px-4 py-3 text-sm text-navy placeholder-navy/30 resize-none focus:outline-none focus:border-accent mb-4"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-navy/30 font-mono">{prompt.length}/1000</span>
                <button
                  onClick={handleConsult}
                  disabled={isLoading || !prompt.trim() || !isConnected}
                  className="bg-accent hover:bg-accent-light disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors"
                >
                  {isLoading ? (oracleId === 'composer' ? loadingLabel : 'Consulting…') : `Pay ${oracle.fee} & Consult`}
                </button>
              </div>
              {error && <p className="text-red-500 text-xs mt-3">{error}</p>}
              {!isConnected && (
                <p className="text-navy/50 text-xs mt-3">
                  <Link href="/" className="text-accent underline">Sign in</Link> to consult the Oracle.
                </p>
              )}
              {oracleId === 'composer' && isLoading && loadingLabel === 'Linking to Smol…' && (
                <p className="text-navy/55 text-xs mt-3">
                  The Composer needs one more passkey assertion to link this wallet to Smol. This
                  should only happen once per active Smol session.
                </p>
              )}
              {oracleId === 'composer' && isLoading && liveTrace.length > 0 && (
                <div className="mt-6">
                  <TraceTimeline
                    steps={liveTrace}
                    title="Full execution trace"
                    variant="full"
                    defaultExpanded={true}
                  />
                </div>
              )}
            </div>
          )}

          {result && resultConsultation && (
            <div className="mt-6 space-y-5">
              <ArtifactCard consultation={resultConsultation} />
              <TraceTimeline
                steps={liveTrace.length ? liveTrace : result.processingTrace}
                title="Full execution trace"
                variant="full"
                defaultExpanded={true}
              />
              <div className="text-center space-y-3">
                <p className="text-xs text-navy/50">Saved to your Codex</p>
                <div className="flex gap-3 justify-center flex-wrap">
                  <button
                    onClick={() => {
                      setResult(null)
                      setPrompt('')
                      setLiveTrace([])
                      setError('')
                    }}
                    className="text-sm border border-accent/30 text-accent px-4 py-2 rounded-lg hover:bg-light-blue transition-colors"
                  >
                    Ask Again
                  </button>
                  <Link
                    href="/midway"
                    className="text-sm bg-accent text-white px-4 py-2 rounded-lg hover:bg-accent-light transition-colors"
                  >
                    More Hosts
                  </Link>
                  <Link
                    href={`/codex/${address}`}
                    className="text-sm border border-navy/20 text-navy/60 px-4 py-2 rounded-lg hover:bg-light-blue transition-colors"
                  >
                    My Codex
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>

        {oracleId === 'informant' && (
          <aside className="bg-white rounded-2xl border border-accent/15 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-navy/45 mb-3">
              Previous Informant Answers
            </p>
            {history.length === 0 ? (
              <p className="text-sm text-navy/45">
                Ask the Informant more than once. Previous riddles will stay here so clue patterns are visible.
              </p>
            ) : (
              <div className="space-y-4">
                {history.map((entry) => (
                  <div key={entry.id} className="border-b last:border-b-0 border-accent/10 pb-4 last:pb-0">
                    <p className="text-xs font-mono text-navy/35 mb-2">
                      {new Date(entry.created_at).toLocaleString()}
                    </p>
                    <p className="text-xs italic text-navy/45 whitespace-pre-wrap mb-2">
                      &ldquo;{entry.prompt}&rdquo;
                    </p>
                    <p className="text-sm text-navy whitespace-pre-wrap leading-relaxed">
                      {entry.artifact_text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
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
    next.forEach((step) => {
      if (step.status === 'pending') step.status = 'success'
    })
  }

  return next
}

function mergeTrace(
  clientTrace: ProcessingTraceStep[],
  serverTrace: ProcessingTraceStep[],
): ProcessingTraceStep[] {
  return [...clientTrace, ...serverTrace]
}

function getPlaceholder(oracleId: string): string {
  const placeholders: Record<string, string> = {
    seer: "Describe yourself — your work, your passions, your year so far…",
    painter: "Describe a person or scene you'd like rendered in pixel art…",
    composer: "Name a theme for your song (e.g. 'late-night coding sessions')…",
    scribe: "Tell me anything. I will answer only in haiku.",
    scholar: "Ask about Stellar, SDF, Lumens, or the blockchain…",
    informant: "Ask me anything. I speak only in riddles.",
  }
  return placeholders[oracleId] ?? 'Your message to the Oracle…'
}
