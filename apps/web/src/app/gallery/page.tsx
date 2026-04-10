'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@/components/WalletProvider'
import { getGallery, castVote } from '@/lib/supabase'
import { createSupabaseClient } from '@/lib/supabase'
import { truncateAddress } from '@/lib/wallet'

interface GalleryEntry {
  wallet_id: string
  stellar_address: string
  display_name: string | null
  oracles_consulted: number
  is_complete: boolean
  vote_count: number
}

export default function GalleryPage() {
  const { address } = useWallet()
  const [entries, setEntries] = useState<GalleryEntry[]>([])
  const [votedFor, setVotedFor] = useState<Set<string>>(new Set())
  const [voteMessages, setVoteMessages] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)

  async function loadGallery() {
    const data = await getGallery()
    setEntries(data as GalleryEntry[])
    setIsLoading(false)
  }

  useEffect(() => {
    loadGallery()

    // Real-time subscription via Supabase
    const supabase = createSupabaseClient()
    const channel = supabase
      .channel('gallery-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultations' }, loadGallery)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, loadGallery)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  async function handleVote(targetAddress: string) {
    if (!address) return

    const result = await castVote(address, targetAddress)
    if (result.success) {
      setVotedFor((prev) => new Set([...prev, targetAddress]))
      setVoteMessages((prev) => ({ ...prev, [targetAddress]: '✓ Voted!' }))
      loadGallery()
    } else {
      setVoteMessages((prev) => ({ ...prev, [targetAddress]: result.error ?? 'Vote failed' }))
    }

    setTimeout(() => {
      setVoteMessages((prev) => {
        const next = { ...prev }
        delete next[targetAddress]
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

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-navy mb-2">Codex Gallery</h1>
        <p className="text-navy/60 text-sm">
          All active seekers. Vote for the Codex that moved you most.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-navy/40">No Codexes yet. Be the first seeker.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {entries.map((entry) => {
            const isMe = entry.stellar_address === address
            const hasVoted = votedFor.has(entry.stellar_address)
            const voteMsg = voteMessages[entry.stellar_address]
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

                <div className="flex items-center justify-between">
                  <Link
                    href={`/codex/${entry.stellar_address}`}
                    className="text-xs text-accent hover:underline"
                  >
                    View Codex →
                  </Link>

                  <div className="flex items-center gap-2">
                    {voteMsg && (
                      <span className="text-xs text-navy/50">{voteMsg}</span>
                    )}
                    {!isMe && address && (
                      <button
                        onClick={() => handleVote(entry.stellar_address)}
                        disabled={hasVoted}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                          hasVoted
                            ? 'bg-accent/10 text-accent/50 cursor-default'
                            : 'bg-light-blue text-accent hover:bg-accent hover:text-white'
                        }`}
                      >
                        {hasVoted ? `★ ${entry.vote_count}` : `☆ ${entry.vote_count}`}
                      </button>
                    )}
                    {(isMe || !address) && (
                      <span className="text-xs text-navy/30">★ {entry.vote_count}</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
