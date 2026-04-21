'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@/components/WalletProvider'
import { consultHiddenOracle, type HiddenOracleResult } from '@/lib/hidden-oracle-api'
import { type Consultation, type ProcessingTraceStep } from '@/types'
import { TraceTimeline } from '@/components/TraceTimeline'
import { ArtifactCard } from '@/components/ArtifactCard'

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
    <div className="max-w-3xl mx-auto px-4 py-12">
      <Link href="/marketplace" className="text-accent/70 hover:text-accent text-sm mb-8 inline-block transition-colors">
        ← Back to Market
      </Link>

      <div className="text-center mb-10">
        <div className="text-6xl mb-4">🗝️</div>
        <h1 className="text-3xl font-bold text-navy mb-2">The Hidden Oracle</h1>
        <p className="text-navy/60 text-sm leading-relaxed max-w-sm mx-auto">
          Your browser generates a zero-knowledge proof that you know the hidden phrase. Soroban verifies that proof on-chain, and only then does the Oracle render your portrait.
        </p>
      </div>

      {!result ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-accent/20 bg-[linear-gradient(145deg,#1c1b27,#262437)] p-8 shadow-[0_24px_60px_rgba(23,22,31,0.22)]">
            {!isConnected ? (
              <div className="text-center">
                <p className="text-white/68 text-sm mb-4">You must be logged in to consult the Hidden Oracle.</p>
                <Link href="/" className="text-accent-light underline text-sm">Sign in →</Link>
              </div>
            ) : (
              <>
                <label className="block text-accent-light text-sm mb-3 font-medium">
                  The Passphrase
                </label>
                <input
                  type="text"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  placeholder="Enter the word you have found…"
                  className="w-full bg-white/8 border border-white/15 text-white placeholder-white/28 rounded-lg px-4 py-3 text-sm mb-4 focus:outline-none focus:border-accent-light font-mono"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                {error && <p className="text-red-400 text-xs mb-4">{error}</p>}
                <button
                  onClick={handleSubmit}
                  disabled={isLoading || !passphrase.trim()}
                  className="w-full bg-accent hover:bg-accent-light disabled:opacity-40 text-white font-semibold py-3 rounded-lg transition-colors"
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
