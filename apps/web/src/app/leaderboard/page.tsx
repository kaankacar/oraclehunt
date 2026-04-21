'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getLeaderboard } from '@/lib/supabase'
import { truncateAddress } from '@/lib/wallet'
import { PROGRESS_ORACLE_IDS } from '@/types'

interface LeaderEntry {
  stellar_address: string
  display_name: string | null
  oracles_consulted: number
  is_complete: boolean
  completed_at: string | null
  vote_count: number
}

export default function LeaderboardPage() {
  const [allEntries, setAllEntries] = useState<LeaderEntry[]>([])
  const [lastUpdated, setLastUpdated] = useState(new Date())

  async function load() {
    const data = await getLeaderboard()
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

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-navy mb-2">Leaderboard</h1>
        <p className="text-navy/60 text-sm">
          Ranked by core oracle progress, then votes, then who finished first.
        </p>
        <p className="text-navy/45 text-xs mt-2">
          Votes are cast in the Gallery and apply to each seeker&apos;s full Codex.
        </p>
        <p className="text-navy/40 text-xs font-mono">
          Updated {lastUpdated.toLocaleTimeString()}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-accent/10 overflow-hidden">
        <div className="hidden sm:grid grid-cols-[56px_1fr_96px_86px] px-4 py-3 text-xs uppercase tracking-wide text-navy/40 border-b border-accent/10">
          <span>Rank</span>
          <span>Seeker</span>
          <span>Core</span>
          <span>Votes</span>
        </div>
        {allEntries.length === 0 ? (
          <div className="px-4 py-8 text-sm text-navy/40 text-center">No entries yet.</div>
        ) : (
          allEntries.map((entry, i) => (
            <Link
              key={`all:${entry.stellar_address}`}
              href={`/codex/${entry.stellar_address}`}
              className="block border-b last:border-b-0 border-accent/5 hover:bg-light-blue/60 transition-colors"
            >
              <div className="hidden sm:grid grid-cols-[56px_1fr_96px_86px] items-center px-4 py-3 text-sm">
                <span className="font-mono text-navy/40">{i + 1}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-semibold text-navy truncate">{displayName(entry)}</p>
                    {entry.is_complete && (
                      <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full shrink-0">
                        Complete
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-navy/35 font-mono truncate">
                    {truncateAddress(entry.stellar_address)}
                    {entry.completed_at && ` · ${new Date(entry.completed_at).toLocaleDateString()}`}
                  </p>
                </div>
                <span className="font-mono text-accent">{entry.oracles_consulted}/{PROGRESS_ORACLE_IDS.length}</span>
                <span className="font-mono text-navy/60">★ {entry.vote_count}</span>
              </div>

              <div className="sm:hidden px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-navy/35 font-mono mb-1">#{i + 1}</p>
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="font-semibold text-navy truncate">{displayName(entry)}</p>
                      {entry.is_complete && (
                        <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full shrink-0">
                          Complete
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-navy/35 font-mono truncate">
                      {truncateAddress(entry.stellar_address)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-accent text-sm">{entry.oracles_consulted}/{PROGRESS_ORACLE_IDS.length}</p>
                    <p className="font-mono text-navy/60 text-xs">★ {entry.vote_count}</p>
                  </div>
                </div>
                {entry.completed_at && (
                  <p className="text-xs text-navy/40">
                    Finished on {new Date(entry.completed_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
