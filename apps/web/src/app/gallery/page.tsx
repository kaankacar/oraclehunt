'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@/components/WalletProvider'
import { ArtifactCard } from '@/components/ArtifactCard'
import { getGallery, getGalleryArtifacts, castVote, createSupabaseClient } from '@/lib/supabase'
import { truncateAddress } from '@/lib/wallet'
import { ORACLES, type Consultation, type OracleId } from '@/types'

interface GalleryEntry {
  wallet_id: string
  stellar_address: string
  display_name: string | null
  oracles_consulted: number
  is_complete: boolean
  vote_count: number
}

interface GalleryArtifact extends Consultation {
  stellar_address: string
  display_name: string | null
  vote_count: number
}

export default function GalleryPage() {
  const { address } = useWallet()
  const [view, setView] = useState<'artifacts' | 'codexes'>('artifacts')
  const [entries, setEntries] = useState<GalleryEntry[]>([])
  const [artifacts, setArtifacts] = useState<GalleryArtifact[]>([])
  const [oracleFilter, setOracleFilter] = useState<OracleId | 'all'>('all')
  const [votedFor, setVotedFor] = useState<Set<string>>(new Set())
  const [voteMessages, setVoteMessages] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)

  async function loadGallery() {
    const [codexData, artifactData] = await Promise.all([getGallery(), getGalleryArtifacts()])
    setEntries(codexData as GalleryEntry[])
    setArtifacts(artifactData as GalleryArtifact[])
    setIsLoading(false)
  }

  useEffect(() => {
    loadGallery()

    const supabase = createSupabaseClient()
    const channel = supabase
      .channel('gallery-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultations' }, loadGallery)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, loadGallery)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  async function handleVote(targetConsultationId: string) {
    if (!address) return

    const result = await castVote(address, targetConsultationId)
    if (result.success) {
      setVotedFor((prev) => new Set([...prev, targetConsultationId]))
      setVoteMessages((prev) => ({ ...prev, [targetConsultationId]: 'Voted' }))
      loadGallery()
    } else {
      setVoteMessages((prev) => ({ ...prev, [targetConsultationId]: result.error ?? 'Vote failed' }))
    }

    setTimeout(() => {
      setVoteMessages((prev) => {
        const next = { ...prev }
        delete next[targetConsultationId]
        return next
      })
    }, 3000)
  }

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center">
        <p className="text-navy/40 text-sm">Gathering the Codexes…</p>
      </div>
    )
  }

  const filteredArtifacts = oracleFilter === 'all'
    ? artifacts
    : artifacts.filter((artifact) => artifact.oracle_id === oracleFilter)

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-navy mb-2">Codex Gallery</h1>
        <p className="text-navy/60 text-sm">
          Explore every oracle output, or switch to the per-seeker Codex view.
        </p>
        <p className="text-navy/45 text-xs mt-2">
          Votes apply to individual artifacts. Seeker totals sum all artifact votes.
        </p>
      </div>

      <div className="flex justify-center gap-3 mb-8">
        <button
          onClick={() => setView('artifacts')}
          className={`px-4 py-2 rounded-full text-sm transition-colors ${
            view === 'artifacts'
              ? 'bg-accent text-white'
              : 'bg-white text-navy/60 border border-accent/15'
          }`}
        >
          Artifact Feed
        </button>
        <button
          onClick={() => setView('codexes')}
          className={`px-4 py-2 rounded-full text-sm transition-colors ${
            view === 'codexes'
              ? 'bg-accent text-white'
              : 'bg-white text-navy/60 border border-accent/15'
          }`}
        >
          Codex Cards
        </button>
      </div>

      {view === 'artifacts' ? (
        <>
          <div className="mb-6 flex flex-wrap justify-center gap-2">
            {[
              { id: 'all' as const, label: 'All' },
              ...ORACLES.map((oracle) => ({ id: oracle.id, label: oracle.name.replace('The ', '') })),
              { id: 'hidden' as const, label: 'Hidden' },
            ].map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setOracleFilter(filter.id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  oracleFilter === filter.id
                    ? 'border-accent bg-accent text-white'
                    : 'border-accent/15 bg-white text-navy/60 hover:border-accent/35'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

        {filteredArtifacts.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-navy/40">No artifacts yet. Be the first seeker.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filteredArtifacts.map((artifact) => {
              const targetAddress = artifact.stellar_address
              const isMe = targetAddress === address
              const hasVoted = votedFor.has(artifact.id)
              const voteMsg = voteMessages[artifact.id]
              const ownerLabel = artifact.display_name ?? truncateAddress(targetAddress)

              return (
                <div key={artifact.id} className="space-y-3">
                  <ArtifactCard
                    consultation={artifact}
                    ownerLabel={`Codex: ${ownerLabel}`}
                    ownerHref={`/codex/${targetAddress}`}
                  />
                  <div className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-accent/10">
                    <Link
                      href={`/codex/${targetAddress}`}
                      className="text-xs text-accent hover:text-accent-light underline"
                    >
                      View full Codex
                    </Link>
                    <div className="flex items-center gap-2">
                      {voteMsg && <span className="text-xs text-navy/50">{voteMsg}</span>}
                      {!isMe && address ? (
                        <button
                          onClick={() => handleVote(artifact.id)}
                          disabled={hasVoted}
                          className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                            hasVoted
                              ? 'bg-accent/10 text-accent/50 cursor-default'
                              : 'bg-light-blue text-accent hover:bg-accent hover:text-white'
                          }`}
                        >
                          {hasVoted ? `★ ${artifact.vote_count}` : `Vote for this artifact · ☆ ${artifact.vote_count}`}
                        </button>
                      ) : (
                        <span className="text-xs text-navy/30">★ {artifact.vote_count}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      }
        </>
      ) : (
        entries.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-navy/40">No Codexes yet. Be the first seeker.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {entries.map((entry) => {
              const isMe = entry.stellar_address === address
              const displayName = entry.display_name ?? truncateAddress(entry.stellar_address)

              return (
                <div key={entry.wallet_id} className={`oracle-card p-5 ${isMe ? 'ring-2 ring-accent' : ''}`}>
                  {isMe && (
                    <div className="text-xs text-accent font-medium mb-2">Your Codex</div>
                  )}

                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-navy text-sm">{displayName}</p>
                      <p className="text-navy/40 text-xs font-mono mt-0.5">
                        {truncateAddress(entry.stellar_address)}
                      </p>
                    </div>
                    {entry.is_complete && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                        Complete
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-navy/50 mb-4">
                    {entry.oracles_consulted}/5 Oracles consulted
                  </div>

                  <p className="text-[11px] text-navy/40 mb-4">
                    Vote totals sum this seeker&apos;s artifact votes.
                  </p>

                  <div className="flex items-center justify-between">
                    <Link
                      href={`/codex/${entry.stellar_address}`}
                      className="text-xs text-accent hover:underline"
                    >
                      View Codex →
                    </Link>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-navy/30">★ {entry.vote_count}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
