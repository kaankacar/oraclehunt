'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getAgenticEconomy, getLeaderboard } from '@/lib/supabase'
import { truncateAddress } from '@/lib/wallet'
import { ORACLES, PROGRESS_ORACLE_IDS } from '@/types'

interface LeaderEntry {
  stellar_address: string
  display_name: string | null
  oracles_consulted: number
  is_complete: boolean
  completed_at: string | null
  vote_count: number
}

interface AgenticEconomyEntry {
  oracle_id: string
  consultations: number
  gross_revenue_usdc: number | string | null
  estimated_model_cost_usdc: number | string | null
  estimated_profit_usdc: number | string | null
  oracle_wallet_address: string | null
}

export default function LeaderboardPage() {
  const [allEntries, setAllEntries] = useState<LeaderEntry[]>([])
  const [economyEntries, setEconomyEntries] = useState<AgenticEconomyEntry[]>([])
  const [board, setBoard] = useState<'seekers' | 'agents'>('seekers')
  const [lastUpdated, setLastUpdated] = useState(new Date())

  async function load() {
    const [data, economy] = await Promise.all([getLeaderboard(), getAgenticEconomy()])
    setAllEntries(data.allEntries as LeaderEntry[])
    setEconomyEntries(economy as AgenticEconomyEntry[])
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
          {board === 'seekers'
            ? 'Seekers are ranked by core oracle progress, then votes, then who finished first.'
            : 'Oracle agents are ranked by estimated profit from paid testnet consultations.'}
        </p>
        <p className="text-navy/45 text-xs mt-2">
          {board === 'seekers'
            ? 'Votes are cast in the Gallery on individual artifacts, then summed by seeker.'
            : 'Agentic Economy values are approximate: gross revenue minus estimated provider cost.'}
        </p>
        <p className="text-navy/40 text-xs font-mono">
          Updated {lastUpdated.toLocaleTimeString()}
        </p>
      </div>

      <div className="mb-6 flex justify-center">
        <div className="relative grid w-full max-w-md grid-cols-2 rounded-full border border-accent/15 bg-white p-1 shadow-sm">
          <div
            className={`absolute bottom-1 top-1 w-[calc(50%-4px)] rounded-full bg-accent transition-transform duration-300 ease-out ${
              board === 'agents' ? 'translate-x-full' : 'translate-x-0'
            }`}
          />
          <button
            type="button"
            onClick={() => setBoard('seekers')}
            className={`relative z-10 min-h-10 text-sm font-semibold transition-colors ${
              board === 'seekers' ? 'text-white' : 'text-navy/60 hover:text-navy'
            }`}
          >
            Seekers
          </button>
          <button
            type="button"
            onClick={() => setBoard('agents')}
            className={`relative z-10 min-h-10 text-sm font-semibold transition-colors ${
              board === 'agents' ? 'text-white' : 'text-navy/60 hover:text-navy'
            }`}
          >
            Agentic Economy
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-accent/10 overflow-hidden">
        {board === 'seekers' ? (
          <>
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
          </>
        ) : (
          <>
          <div className="hidden md:grid grid-cols-[1fr_88px_110px_110px_110px_150px] px-4 py-3 text-xs uppercase tracking-wide text-navy/40 border-b border-accent/10">
            <span>Oracle Agent</span>
            <span>Runs</span>
            <span>Gross</span>
            <span>Cost Est.</span>
            <span>Profit</span>
            <span>Wallet</span>
          </div>
          {economyEntries.length === 0 ? (
            <div className="px-4 py-8 text-sm text-navy/40 text-center">No agent earnings yet.</div>
          ) : (
            economyEntries.map((entry) => {
              const oracle = ORACLES.find((item) => item.id === entry.oracle_id)
              return (
                <div
                  key={entry.oracle_id}
                  className="border-b last:border-b-0 border-accent/5 px-4 py-3 text-sm"
                >
                  <div className="hidden md:grid grid-cols-[1fr_88px_110px_110px_110px_150px] items-center">
                    <span className="font-semibold text-navy">{oracle?.name ?? entry.oracle_id}</span>
                    <span className="font-mono text-navy/60">{entry.consultations}</span>
                    <span className="font-mono text-navy/60">${formatMoney(entry.gross_revenue_usdc)}</span>
                    <span className="font-mono text-navy/60">${formatMoney(entry.estimated_model_cost_usdc)}</span>
                    <span className="font-mono text-accent">
                      ${formatMoney(entry.estimated_profit_usdc)} · {formatProfitMargin(entry)}
                    </span>
                    <span className="font-mono text-xs text-navy/45 truncate">
                      {entry.oracle_wallet_address ? truncateAddress(entry.oracle_wallet_address) : 'unconfigured'}
                    </span>
                  </div>
                  <div className="md:hidden space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-navy">{oracle?.name ?? entry.oracle_id}</span>
                      <span className="font-mono text-accent">{formatProfitMargin(entry)}</span>
                    </div>
                    <p className="text-xs text-navy/45">
                      {entry.consultations} runs · ${formatMoney(entry.estimated_profit_usdc)} profit · ${formatMoney(entry.gross_revenue_usdc)} gross · ${formatMoney(entry.estimated_model_cost_usdc)} estimated cost
                    </p>
                    <p className="font-mono text-xs text-navy/35">
                      {entry.oracle_wallet_address ? truncateAddress(entry.oracle_wallet_address) : 'wallet unconfigured'}
                    </p>
                  </div>
                </div>
              )
            })
          )}
          </>
        )}
      </div>
    </div>
  )
}

function toNumber(value: number | string | null): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function formatMoney(value: number | string | null): string {
  return toNumber(value).toFixed(4)
}

function formatProfitMargin(entry: AgenticEconomyEntry): string {
  const gross = toNumber(entry.gross_revenue_usdc)
  if (gross <= 0) return '0.00% margin'
  return `${((toNumber(entry.estimated_profit_usdc) / gross) * 100).toFixed(2)}% margin`
}
