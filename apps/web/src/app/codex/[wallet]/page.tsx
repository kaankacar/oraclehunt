'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ORACLES, PROGRESS_ORACLE_IDS, isProgressOracleId, type Consultation } from '@/types'
import { getCodex, getPublicDisplayName } from '@/lib/supabase'
import { truncateAddress } from '@/lib/wallet'
import { useWallet } from '@/components/WalletProvider'
import { ArtifactCard } from '@/components/ArtifactCard'

export default function CodexPage() {
  const params = useParams()
  const walletParam = params['wallet'] as string
  const { address: myAddress } = useWallet()

  const [consultations, setConsultations] = useState<Consultation[]>([])
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const isOwner = myAddress === walletParam

  useEffect(() => {
    Promise.all([getCodex(walletParam), getPublicDisplayName(walletParam)])
      .then(([codex, name]) => {
        setConsultations(codex as Consultation[])
        setDisplayName(name)
      })
      .finally(() => setIsLoading(false))
  }, [walletParam])

  const uniqueOracles = new Set(consultations.map((c) => c.oracle_id))
  const progressOracles = new Set(consultations.map((c) => c.oracle_id).filter(isProgressOracleId))
  const isComplete = progressOracles.size >= PROGRESS_ORACLE_IDS.length

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
            {isOwner ? 'My Codex' : displayName ? `${displayName}'s Codex` : 'Oracle Codex'}
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
            {progressOracles.size}/{PROGRESS_ORACLE_IDS.length} Core Oracles {isComplete ? '✓ Complete' : ''}
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
            <Link href="/midway" className="text-accent text-sm underline">
              Consult your first Oracle →
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {consultations.map((c) => (
            <ArtifactCard key={c.id} consultation={c} />
          ))}
        </div>
      )}
    </div>
  )
}
