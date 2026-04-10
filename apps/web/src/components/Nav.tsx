'use client'

import Link from 'next/link'
import { useWallet } from './WalletProvider'

export function Nav() {
  const { displayAddress, balance, isConnected } = useWallet()

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-navy border-b border-accent/30">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="text-white font-bold text-lg tracking-wide hover:text-accent-light transition-colors">
          Oracle Hunt
        </Link>

        <div className="flex items-center gap-6">
          <Link href="/marketplace" className="text-white/80 hover:text-white text-sm transition-colors">
            Oracles
          </Link>
          <Link href="/gallery" className="text-white/80 hover:text-white text-sm transition-colors">
            Gallery
          </Link>
          <Link href="/leaderboard" className="text-white/80 hover:text-white text-sm transition-colors">
            Leaderboard
          </Link>

          {isConnected ? (
            <div className="flex items-center gap-3">
              <Link
                href={`/codex/${displayAddress}`}
                className="text-xs font-mono text-accent-light hover:text-white transition-colors"
              >
                {displayAddress}
              </Link>
              {balance !== null && (
                <span className="bg-accent/20 text-accent-light text-xs font-mono px-2 py-1 rounded">
                  ${balance} USDC
                </span>
              )}
            </div>
          ) : (
            <Link
              href="/"
              className="bg-accent text-white text-sm px-4 py-1.5 rounded hover:bg-accent-light transition-colors"
            >
              Enter
            </Link>
          )}
        </div>
      </div>
    </nav>
  )
}
