'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getLeaderboard } from '@/lib/supabase'
import { truncateAddress } from '@/lib/wallet'

interface LeaderEntry {
  stellar_address: string
  display_name: string | null
  oracles_consulted: number
  is_complete: boolean
  completed_at: string | null
  vote_count: number
}

export default function LeaderboardPage() {
  const [byCompletion, setByCompletion] = useState<LeaderEntry[]>([])
  const [byVotes, setByVotes] = useState<LeaderEntry[]>([])
  const [allEntries, setAllEntries] = useState<LeaderEntry[]>([])
  const [lastUpdated, setLastUpdated] = useState(new Date())

  async function load() {
    const data = await getLeaderboard()
    setByCompletion(data.byCompletion as LeaderEntry[])
    setByVotes(data.byVotes as LeaderEntry[])
    setAllEntries(data.allEntries as LeaderEntry[])
    setLastUpdated(new Date())
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [])

  function displayName(entry: LeaderEntry) {
    return entry.display_name ?? truncateAddress(entry.stellar_address)
  }

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-navy mb-2">Leaderboard</h1>
        <p className="text-navy/40 text-xs font-mono">
          Updated {lastUpdated.toLocaleTimeString()}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* By completion */}
        <div>
          <h2 className="text-lg font-bold text-navy mb-4 flex items-center gap-2">
            <span>🔮</span> Most Oracles Consulted
          </h2>
          <div className="space-y-2">
            {byCompletion.map((entry, i) => (
              <Link
                key={entry.stellar_address}
                href={`/codex/${entry.stellar_address}`}
                className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-accent/10 hover:border-accent/30 transition-colors"
              >
                <span className="text-lg w-8">{medals[i] ?? `${i + 1}.`}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-navy truncate">{displayName(entry)}</p>
                  {entry.is_complete && (
                    <p className="text-xs text-green-600">
                      ✓ Complete
                      {entry.completed_at && ` · ${new Date(entry.completed_at).toLocaleDateString()}`}
                    </p>
                  )}
                </div>
                <span className="text-accent font-mono font-bold text-sm">
                  {entry.oracles_consulted}/5
                </span>
              </Link>
            ))}
            {byCompletion.length === 0 && (
              <p className="text-navy/40 text-sm text-center py-6">No entries yet.</p>
            )}
          </div>
        </div>

        {/* By votes */}
        <div>
          <h2 className="text-lg font-bold text-navy mb-4 flex items-center gap-2">
            <span>⭐</span> Crowd Favorites
          </h2>
          <div className="space-y-2">
            {byVotes.map((entry, i) => (
              <Link
                key={entry.stellar_address}
                href={`/codex/${entry.stellar_address}`}
                className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-accent/10 hover:border-accent/30 transition-colors"
              >
                <span className="text-lg w-8">{medals[i] ?? `${i + 1}.`}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-navy truncate">{displayName(entry)}</p>
                </div>
                <span className="text-accent font-mono font-bold text-sm">
                  ★ {entry.vote_count}
                </span>
              </Link>
            ))}
            {byVotes.length === 0 && (
              <p className="text-navy/40 text-sm text-center py-6">No votes cast yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-12">
        <h2 className="text-lg font-bold text-navy mb-4">All Seekers</h2>
        <div className="bg-white rounded-2xl border border-accent/10 overflow-hidden">
          <div className="grid grid-cols-[56px_1fr_100px_90px] px-4 py-3 text-xs uppercase tracking-wide text-navy/40 border-b border-accent/10">
            <span>Rank</span>
            <span>Seeker</span>
            <span>Oracles</span>
            <span>Votes</span>
          </div>
          {allEntries.length === 0 ? (
            <div className="px-4 py-8 text-sm text-navy/40 text-center">No entries yet.</div>
          ) : (
            allEntries.map((entry, i) => (
              <Link
                key={`all:${entry.stellar_address}`}
                href={`/codex/${entry.stellar_address}`}
                className="grid grid-cols-[56px_1fr_100px_90px] items-center px-4 py-3 text-sm border-b last:border-b-0 border-accent/5 hover:bg-light-blue/60 transition-colors"
              >
                <span className="font-mono text-navy/40">{i + 1}</span>
                <div className="min-w-0">
                  <p className="font-semibold text-navy truncate">{displayName(entry)}</p>
                  <p className="text-xs text-navy/35 font-mono truncate">
                    {truncateAddress(entry.stellar_address)}
                  </p>
                </div>
                <span className="font-mono text-accent">{entry.oracles_consulted}/5</span>
                <span className="font-mono text-navy/60">★ {entry.vote_count}</span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
