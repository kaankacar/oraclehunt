'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@/components/WalletProvider'
import { consultHiddenOracle, type HiddenOracleResult } from '@/lib/oracle-api'

export default function HiddenOraclePage() {
  const { address, isConnected } = useWallet()
  const [passphrase, setPassphrase] = useState('')
  const [result, setResult] = useState<HiddenOracleResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!isConnected || !address) return
    if (!passphrase.trim()) return

    setIsLoading(true)
    setError('')

    try {
      const data = await consultHiddenOracle(address, passphrase.trim())
      setResult(data)
    } catch (err) {
      if (err instanceof Error && err.message === 'INVALID_PASSPHRASE') {
        setError('The Oracle does not recognize your phrase. Seek deeper.')
      } else {
        setError('The Oracle is silent. Try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <Link href="/marketplace" className="text-accent/70 hover:text-accent text-sm mb-8 inline-block transition-colors">
        ← Back to Market
      </Link>

      <div className="text-center mb-10">
        <div className="text-6xl mb-4">🗝️</div>
        <h1 className="text-3xl font-bold text-navy mb-2">The Hidden Oracle</h1>
        <p className="text-navy/60 text-sm leading-relaxed max-w-sm mx-auto">
          This Oracle reveals itself only to those who have listened carefully.
          The Informant has left you the key.
        </p>
      </div>

      {!result ? (
        <div className="bg-navy rounded-2xl p-8 border border-accent/30">
          {!isConnected ? (
            <div className="text-center">
              <p className="text-white/60 text-sm mb-4">You must be logged in to consult the Hidden Oracle.</p>
              <Link href="/" className="text-accent-light underline text-sm">Sign in →</Link>
            </div>
          ) : (
            <>
              <label className="block text-white/70 text-sm mb-3 font-medium">
                The Passphrase
              </label>
              <input
                type="text"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="Enter the word you have found…"
                className="w-full bg-white/10 border border-white/20 text-white placeholder-white/30 rounded-lg px-4 py-3 text-sm mb-4 focus:outline-none focus:border-accent-light font-mono"
                autoCapitalize="none"
                autoCorrect="off"
              />
              {error && <p className="text-red-400 text-xs mb-4">{error}</p>}
              <button
                onClick={handleSubmit}
                disabled={isLoading || !passphrase.trim()}
                className="w-full bg-accent hover:bg-accent-light disabled:opacity-40 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {isLoading ? 'The Oracle stirs…' : 'Speak the Phrase'}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* ZK Portrait */}
          <div className="bg-white rounded-2xl border border-accent/15 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">🗝️</span>
              <span className="text-xs font-medium text-accent uppercase tracking-wide">The Hidden Oracle</span>
              <span className="text-xs text-navy/30 ml-auto font-mono">
                {new Date(result.timestamp).toLocaleString()}
              </span>
            </div>
            <p className="text-navy leading-relaxed text-sm whitespace-pre-wrap">{result.zkPortrait}</p>
          </div>

          {/* ZK Fingerprint */}
          <div>
            <p className="text-xs font-medium text-navy/60 mb-2 uppercase tracking-wide">
              Your Zero-Knowledge Identity Fingerprint
            </p>
            <div className="fingerprint-display">
              {result.fingerprint}
            </div>
            <p className="text-xs text-navy/40 mt-2">
              This fingerprint is unique to your Stellar wallet. It proves your identity without revealing your address.
            </p>
          </div>

          <div className="text-center space-y-2">
            <p className="text-xs text-green-600 font-medium">✓ Saved to your Codex</p>
            <Link
              href={`/codex/${address}`}
              className="inline-block text-sm bg-accent text-white px-6 py-2.5 rounded-lg hover:bg-accent-light transition-colors"
            >
              View My Codex
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
