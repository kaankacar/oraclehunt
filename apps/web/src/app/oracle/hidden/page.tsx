'use client'

import { useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useWallet } from '@/components/WalletProvider'
import { consultHiddenOracle, type HiddenOracleResult } from '@/lib/hidden-oracle-api'
import { type Consultation, type ProcessingTraceStep } from '@/types'
import { TraceTimeline } from '@/components/TraceTimeline'
import { ArtifactCard } from '@/components/ArtifactCard'
import MidwayNav from '@/components/midway/MidwayNav'

const HIDDEN_THEME_RGB = '232, 192, 110'

const HIDDEN_TRACE_TEMPLATE: ProcessingTraceStep[] = [
  {
    id: 'client:hidden-challenge',
    label: 'Issuing One-Time Challenge',
    status: 'pending',
    detail: 'The worker derives a wallet-bound fingerprint on Soroban and mints a nonce for this attempt.',
  },
  {
    id: 'client:hidden-witness',
    label: 'Preparing Private Witness',
    status: 'pending',
    detail: 'The browser normalizes your wallet and phrase into private witness inputs for the circuit.',
  },
  {
    id: 'client:hidden-proof',
    label: 'Generating Proof Locally',
    status: 'pending',
    detail: 'The BN254 proof is generated in your browser. The phrase does not get posted to the worker.',
  },
  {
    id: 'client:hidden-request',
    label: 'Relaying Proof Verification to Soroban',
    status: 'pending',
    detail: 'The worker relays the on-chain verification transaction. The portrait renders only after Soroban accepts the proof.',
  },
]

export default function HiddenOraclePage() {
  const { address, isConnected } = useWallet()
  const [passphrase, setPassphrase] = useState('')
  const [result, setResult] = useState<HiddenOracleResult | null>(null)
  const [trace, setTrace] = useState<ProcessingTraceStep[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!isConnected || !address) return
    if (!passphrase.trim()) return

    setIsLoading(true)
    setError('')
    setTrace(HIDDEN_TRACE_TEMPLATE.map((step, index) => ({
      ...step,
      status: index === 0 ? 'pending' : 'pending',
    })))

    try {
      const data = await consultHiddenOracle(address, passphrase.trim(), {
        onProgress: (event) => {
          if (event === 'hidden-challenge-ready') {
            setTrace((prev) => prev.map((step) => {
              if (step.id === 'client:hidden-challenge' || step.id === 'client:hidden-witness') {
                return { ...step, status: 'success' }
              }
              return step
            }))
          }
          if (event === 'generate-hidden-proof') {
            setTrace((prev) => prev.map((step) => (
              step.id === 'client:hidden-proof'
                ? { ...step, status: 'pending' }
                : step
            )))
          }
          if (event === 'hidden-proof-generated') {
            setTrace((prev) => prev.map((step) => (
              step.id === 'client:hidden-proof'
                ? { ...step, status: 'success' }
                : step
            )))
          }
          if (event === 'submit-hidden-proof') {
            setTrace((prev) => prev.map((step) => (
              step.id === 'client:hidden-request'
                ? { ...step, status: 'pending' }
                : step
            )))
          }
          if (event === 'hidden-oracle-response-received') {
            setTrace((prev) => prev.map((step) => ({ ...step, status: 'success' })))
          }
        },
      })
      setTrace((prev) => [...prev, ...data.processingTrace])
      setResult(data)
    } catch (err) {
      if (err instanceof Error && err.message === 'INVALID_PASSPHRASE') {
        setError('The Oracle does not recognize your phrase. Seek deeper.')
      } else {
        setError(err instanceof Error ? err.message : 'The Oracle is silent. Try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const consultation = result
      ? ({
        id: `hidden:${result.timestamp}`,
        wallet_id: '',
        oracle_id: 'hidden',
        prompt: '[ZK Portrait Request] Passphrase accepted.',
        artifact_text: result.zkPortrait,
        artifact_image: result.artifactImage ?? null,
        tx_hash: result.txHash ?? null,
        processing_trace: trace.length ? trace : result.processingTrace,
        fingerprint: result.fingerprint,
        zk_contract_id: result.zkContractId ?? null,
        zk_tx_hash: result.zkTxHash ?? null,
        zk_verify_tx_hash: result.zkVerifyTxHash ?? null,
        created_at: result.timestamp,
      } as Consultation)
    : null

  return (
    <div
      className="relative max-w-3xl mx-auto px-4 pt-24 pb-12"
      style={{ '--theme-rgb': HIDDEN_THEME_RGB } as CSSProperties}
    >
      <div
        className="fixed inset-0 -z-10 bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: "url('/images/hiddenoraclebackground.png')" }}
      />
      <div className="fixed inset-0 -z-10 bg-black/50 pointer-events-none" />

      <MidwayNav backHref="/midway" backLabel="Back to the Midway" />

      <div className="text-center mb-10 md:pl-16 lg:pl-24">
        <img
          src="/images/keyicon.png"
          alt="Key"
          className="mx-auto mb-3 h-24 w-24 object-contain animate-oracle-orb"
        />
        <h1
          className="font-title text-4xl md:text-5xl font-semibold tracking-[0.15em] text-white/90 mb-2"
          style={{ textShadow: '0 2px 20px rgba(0,0,0,0.9), 0 0 40px rgba(var(--theme-rgb), 0.3)' }}
        >
          The Hidden Oracle
        </h1>
        <p className="font-body text-chrome-bright/75 text-sm md:text-base leading-relaxed max-w-md mx-auto tracking-wide">
          Your browser generates a zero-knowledge proof that you know the hidden phrase. Soroban verifies that proof on-chain, and only then does the Oracle render your portrait.
        </p>
      </div>

      {!result ? (
        <div className="space-y-6 md:pl-16 lg:pl-24">
          <div className="relative rounded-2xl border border-[rgba(var(--theme-rgb),0.3)] bg-midnight/55 backdrop-blur-md p-8 shadow-[0_0_40px_rgba(var(--theme-rgb),0.18),inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_40px_rgba(var(--theme-rgb),0.08)]">
            {!isConnected ? (
              <div className="text-center">
                <p className="text-chrome-bright/75 text-sm mb-4 font-body">You must be logged in to consult the Hidden Oracle.</p>
                <Link
                  href="/"
                  className="text-[rgba(var(--theme-rgb),0.9)] underline hover:text-[rgb(var(--theme-rgb))] text-sm"
                >
                  Sign in →
                </Link>
              </div>
            ) : (
              <>
                <label className="block text-chrome-bright/75 text-sm mb-3 font-body tracking-wide">
                  The Passphrase
                </label>
                <input
                  type="text"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  placeholder="Enter the word you have found…"
                  className="w-full bg-black/40 border border-[rgba(var(--theme-rgb),0.25)] text-chrome-bright placeholder:text-chrome-dim/60 rounded-lg px-4 py-3 text-sm mb-4 focus:outline-none focus:border-[rgba(var(--theme-rgb),0.6)] focus:shadow-[0_0_18px_rgba(var(--theme-rgb),0.35)] font-mono transition-all"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                {error && (
                  <p className="text-[rgba(var(--theme-rgb),0.9)] text-xs mb-4">{error}</p>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={isLoading || !passphrase.trim()}
                  className="w-full bg-[rgba(var(--theme-rgb),0.8)] hover:bg-[rgb(var(--theme-rgb))] disabled:opacity-40 text-midnight font-semibold py-3 rounded-lg transition-all shadow-[0_0_20px_rgba(var(--theme-rgb),0.45)] hover:shadow-[0_0_28px_rgba(var(--theme-rgb),0.6)] tracking-wide"
                >
                  {isLoading ? 'The Oracle stirs…' : 'Prove the Phrase'}
                </button>
              </>
            )}
          </div>

        </div>
      ) : (
        <div className="space-y-6">
          {consultation && <ArtifactCard consultation={consultation} />}

          <TraceTimeline
            steps={trace.length ? trace : result.processingTrace}
            title="Full execution trace"
            variant="full"
            defaultExpanded={true}
          />

          <div className="flex flex-wrap gap-3 justify-center">
            {result.contractExplorerUrl && (
              <a
                href={result.contractExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm border border-accent/30 text-accent px-4 py-2 rounded-lg hover:bg-light-blue transition-colors"
              >
                Open verifier contract on Stellar Expert
              </a>
            )}
            {result.fingerprintContractExplorerUrl && (
              <a
                href={result.fingerprintContractExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm border border-accent/30 text-accent px-4 py-2 rounded-lg hover:bg-light-blue transition-colors"
              >
                Open fingerprint contract on Stellar Expert
              </a>
            )}
            {result.explorerUrl && (
              <a
                href={result.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm border border-accent/30 text-accent px-4 py-2 rounded-lg hover:bg-light-blue transition-colors"
              >
                Open proof verification transaction on Stellar Expert
              </a>
            )}
            <Link
              href={`/codex/${address}`}
              className="text-sm bg-accent text-white px-6 py-2.5 rounded-lg hover:bg-accent-light transition-colors"
            >
              View My Codex
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
