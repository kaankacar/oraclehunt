'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ORACLES, type OracleMeta } from '@/types'
import { useWallet } from '@/components/WalletProvider'
import { consultOracle, type OracleResult } from '@/lib/oracle-api'

export default function OraclePage() {
  const params = useParams()
  const oracleId = params['id'] as string
  const router = useRouter()

  const { address, isConnected, refreshBalance } = useWallet()
  const [oracle, setOracle] = useState<OracleMeta | null>(null)
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<OracleResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const found = ORACLES.find((o) => o.id === oracleId)
    if (!found) router.push('/marketplace')
    else setOracle(found)
  }, [oracleId, router])

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

    try {
      const data = await consultOracle(oracleId, prompt, address)

      setResult(data)
      await refreshBalance()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The Oracle is silent. Try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const oracleAscii: Record<string, string> = {
    seer:      '✦ ✦ ✦  👁  ✦ ✦ ✦',
    painter:   '▓▒░ 🎨 ░▒▓',
    composer:  '♩ ♪ ♫ 🎵 ♫ ♪ ♩',
    scribe:    '— 📜 —',
    scholar:   '⌗ 📚 ⌗',
    informant: '// 🕵️ //',
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <Link href="/marketplace" className="text-accent/70 hover:text-accent text-sm mb-8 inline-block transition-colors">
        ← Back to Market
      </Link>

      {/* Oracle header */}
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

      {/* Prompt input */}
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
              {isLoading ? 'Consulting…' : `Pay ${oracle.fee} & Consult`}
            </button>
          </div>
          {error && <p className="text-red-500 text-xs mt-3">{error}</p>}
          {!isConnected && (
            <p className="text-navy/50 text-xs mt-3">
              <Link href="/" className="text-accent underline">Sign in</Link> to consult the Oracle.
            </p>
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <div className="artifact-card p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">{oracle.emoji}</span>
              <span className="text-xs font-medium text-accent uppercase tracking-wide">{oracle.name}</span>
              <span className="text-xs text-navy/30 ml-auto font-mono">
                {new Date(result.timestamp).toLocaleString()}
              </span>
            </div>
            {result.artifactImage ? (
              <div className="space-y-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.artifactImage}
                  alt="Pixel art portrait by The Painter"
                  className="w-full rounded-lg image-rendering-pixelated"
                  style={{ imageRendering: 'pixelated' }}
                />
                {result.artifact && result.artifact !== 'Your pixel art portrait has been rendered.' && (
                  <p className="text-navy leading-relaxed whitespace-pre-wrap text-sm">{result.artifact}</p>
                )}
              </div>
            ) : (
              <p className="text-navy leading-relaxed whitespace-pre-wrap text-sm">{result.artifact}</p>
            )}
            {result.txHash && (
              <p className="text-xs text-navy/30 font-mono mt-4 truncate">tx: {result.txHash}</p>
            )}
          </div>

          <div className="text-center space-y-3">
            <p className="text-xs text-navy/50">Saved to your Codex</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => { setResult(null); setPrompt('') }}
                className="text-sm border border-accent/30 text-accent px-4 py-2 rounded-lg hover:bg-light-blue transition-colors"
              >
                Ask Again
              </button>
              <Link
                href="/marketplace"
                className="text-sm bg-accent text-white px-4 py-2 rounded-lg hover:bg-accent-light transition-colors"
              >
                More Oracles
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
  )
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
  return placeholders[oracleId] ?? "Your message to the Oracle…"
}
