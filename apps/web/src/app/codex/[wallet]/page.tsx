'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ORACLES, type Consultation } from '@/types'
import { getCodex } from '@/lib/supabase'
import { truncateAddress } from '@/lib/wallet'
import { useWallet } from '@/components/WalletProvider'

const ORACLE_EMOJI: Record<string, string> = {
  seer: '🔮', painter: '🎨', composer: '🎵',
  scribe: '📜', scholar: '📚', informant: '🕵️', hidden: '🗝️',
}

const ORACLE_NAME: Record<string, string> = {
  seer: 'The Seer', painter: 'The Painter', composer: 'The Composer',
  scribe: 'The Scribe', scholar: 'The Scholar', informant: 'The Informant', hidden: 'The Hidden Oracle',
}

export default function CodexPage() {
  const params = useParams()
  const walletParam = params['wallet'] as string
  const { address: myAddress } = useWallet()

  const [consultations, setConsultations] = useState<Consultation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const isOwner = myAddress === walletParam

  useEffect(() => {
    getCodex(walletParam)
      .then((data) => setConsultations(data as Consultation[]))
      .finally(() => setIsLoading(false))
  }, [walletParam])

  const uniqueOracles = new Set(consultations.map((c) => c.oracle_id))
  const isComplete = uniqueOracles.size >= 5

  function copyShareLink() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <p className="text-navy/40 text-sm">Reading the Codex…</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy mb-1">
            {isOwner ? 'My Codex' : 'Oracle Codex'}
          </h1>
          <p className="font-mono text-navy/40 text-sm">{truncateAddress(walletParam)}</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Completion badge */}
          <div className={`px-3 py-1.5 rounded-full text-sm font-medium ${
            isComplete
              ? 'bg-green-100 text-green-700'
              : 'bg-light-blue text-accent'
          }`}>
            {uniqueOracles.size}/5 Oracles {isComplete ? '✓ Complete' : ''}
          </div>

          <button
            onClick={copyShareLink}
            className="text-sm border border-accent/30 text-accent px-4 py-1.5 rounded-lg hover:bg-light-blue transition-colors"
          >
            {copied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </div>

      {/* Oracle completion dots */}
      <div className="flex gap-2 mb-8 flex-wrap">
        {ORACLES.map((o) => (
          <div
            key={o.id}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border ${
              uniqueOracles.has(o.id)
                ? 'bg-accent text-white border-accent'
                : 'bg-white text-navy/40 border-navy/10'
            }`}
          >
            <span>{o.emoji}</span>
            <span>{o.name.replace('The ', '')}</span>
          </div>
        ))}
        <div
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border ${
            uniqueOracles.has('hidden')
              ? 'bg-navy text-white border-navy'
              : 'bg-white text-navy/40 border-navy/10'
          }`}
        >
          <span>🗝️</span>
          <span>Hidden</span>
        </div>
      </div>

      {/* Artifacts */}
      {consultations.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-navy/40 text-sm mb-4">No artifacts yet.</p>
          {isOwner && (
            <Link href="/marketplace" className="text-accent text-sm underline">
              Consult your first Oracle →
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {consultations.map((c) => (
            <div key={c.id} className={`artifact-card p-5 shadow-sm ${c.oracle_id === 'hidden' ? 'border-l-navy' : ''}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">{ORACLE_EMOJI[c.oracle_id] ?? '✦'}</span>
                <span className="text-xs font-semibold text-accent uppercase tracking-wide">
                  {ORACLE_NAME[c.oracle_id] ?? c.oracle_id}
                </span>
                <span className="text-xs text-navy/30 ml-auto font-mono">
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="text-navy/50 text-xs italic mb-2 truncate">&ldquo;{c.prompt}&rdquo;</p>
              <p className="text-navy text-sm leading-relaxed whitespace-pre-wrap line-clamp-6">
                {c.artifact_text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
