'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ORACLES, PROGRESS_ORACLE_IDS, isProgressOracleId } from '@/types'
import { useWallet } from '@/components/WalletProvider'
import { getConsultedOracles } from '@/lib/supabase'

export default function MarketplacePage() {
  const { address, isConnected } = useWallet()
  const [consulted, setConsulted] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!address) return
    getConsultedOracles(address).then(setConsulted)
  }, [address])

  const completionCount = Array.from(consulted).filter(isProgressOracleId).length
  const isComplete = completionCount >= PROGRESS_ORACLE_IDS.length

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-navy mb-2">Oracle Market</h1>
        <p className="text-navy/60">Choose your Oracle. Pay the fee. Receive your artifact.</p>

        {isConnected && (
          <div className="mt-4 inline-flex items-center gap-2 bg-white border border-accent/20 rounded-full px-4 py-2 text-sm">
            <span className="text-navy/60">Codex progress:</span>
            <span className="font-semibold text-accent">{completionCount} / {PROGRESS_ORACLE_IDS.length} Core Oracles</span>
            {isComplete && <span className="text-green-600">✓ Complete!</span>}
          </div>
        )}
      </div>

      {/* Oracle grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {ORACLES.map((oracle) => {
          const isConsulted = consulted.has(oracle.id)

          return (
            <div key={oracle.id} className="oracle-card p-6 relative">
              {isConsulted && (
                <div className="absolute top-3 right-3 bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">
                  Consulted
                </div>
              )}

              <div className="text-4xl mb-3">{oracle.emoji}</div>
              <h2 className="text-xl font-bold text-navy mb-1">{oracle.name}</h2>
              <p className="text-accent text-sm font-medium mb-3">{oracle.specialty}</p>
              <p className="text-navy/60 text-sm mb-5 leading-relaxed">{oracle.description}</p>

              <div className="flex items-center justify-between">
                <span className="bg-light-blue text-accent font-mono text-sm font-semibold px-3 py-1 rounded">
                  {oracle.fee} USDC
                </span>
                <Link
                  href={`/oracle/${oracle.id}`}
                  className="bg-accent hover:bg-accent-light text-white text-sm px-4 py-2 rounded-lg transition-colors"
                >
                  Consult
                </Link>
              </div>
            </div>
          )
        })}

        {/* Hidden Oracle card — always locked */}
        <div className="oracle-card p-6 opacity-80 relative overflow-hidden">
          <div className="absolute inset-0 bg-navy/5" />
          <div className="relative">
            <div className="text-4xl mb-3 grayscale">🗝️</div>
            <h2 className="text-xl font-bold text-navy mb-1">The Hidden Oracle</h2>
            <p className="text-navy/40 text-sm font-medium mb-3">Client-Side Proof, Soroban Verification</p>
            <p className="text-navy/50 text-sm mb-5 leading-relaxed italic">
              Its location is unknown. Find the phrase in The Informant&apos;s riddles, prove it in your browser, and let Soroban verify the proof on-chain.
            </p>
            <div className="flex items-center justify-between">
              <span className="bg-navy/10 text-navy/40 font-mono text-sm px-3 py-1 rounded">
                ???
              </span>
              <Link
                href="/oracle/hidden"
                className="bg-navy/20 hover:bg-navy/30 text-navy/60 text-sm px-4 py-2 rounded-lg transition-colors"
              >
                I have the phrase
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Completion CTA */}
      {isConnected && completionCount > 0 && (
        <div className="mt-10 text-center">
          <Link
            href={`/codex/${address}`}
            className="text-accent hover:text-accent-light text-sm underline transition-colors"
          >
            View your Oracle Codex →
          </Link>
        </div>
      )}
    </div>
  )
}
