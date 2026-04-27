'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { useWallet } from './WalletProvider'

const HOW_IT_WORKS_ROUTE = '/how-it-works' as Route

export function Nav() {
  const { address, displayAddress, balance, username, isConnected, logout } = useWallet()
  const [copied, setCopied] = useState(false)

  async function copyAddress() {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

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
          <Link href={HOW_IT_WORKS_ROUTE} className="text-white/80 hover:text-white text-sm transition-colors">
            How It Works
          </Link>
          {isConnected && address && (
            <Link href={`/codex/${address}`} className="text-white/80 hover:text-white text-sm transition-colors">
              My Codex
            </Link>
          )}

          {isConnected ? (
            <div className="flex items-center gap-3">
              {username && (
                <span className="text-xs text-white/70">
                  @{username}
                </span>
              )}
              {address && (
                <button
                  type="button"
                  onClick={copyAddress}
                  className="group relative text-xs font-mono text-accent-light hover:text-white transition-colors"
                  aria-label="Copy wallet address"
                >
                  {displayAddress}
                  <span className="pointer-events-none absolute right-0 top-full mt-2 whitespace-nowrap rounded bg-navy/95 px-2 py-1 text-[10px] font-sans text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    {copied ? 'Copied' : 'Copy address'}
                  </span>
                </button>
              )}
              {balance !== null && (
                <span className="bg-accent/20 text-accent-light text-xs font-mono px-2 py-1 rounded">
                  ${balance} USDC
                </span>
              )}
              <button
                onClick={logout}
                className="text-white/40 hover:text-white/80 text-xs transition-colors"
              >
                Sign out
              </button>
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
