'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import type { Route } from 'next'
import { useWallet } from '@/components/WalletProvider'

interface MidwayNavProps {
  backHref?: Route
  backLabel?: string
}

export default function MidwayNav({
  backHref = '/' as Route,
  backLabel = 'Back',
}: MidwayNavProps) {
  const { address, displayAddress, balance, username, isConnected, logout } = useWallet()

  return (
    <motion.nav
      className="fixed top-0 left-0 right-0 z-50 bg-midnight/80 backdrop-blur-md border-b border-white/10"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      <div className="w-full px-4 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between h-16">
          <Link
            href={backHref}
            className="text-base text-chrome-dim hover:text-white transition-colors flex items-center gap-2 font-body"
          >
            <span>←</span>
            <span>{backLabel}</span>
          </Link>

          <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-8 font-body">
            <Link href="/midway" className="text-base text-composer hover:text-white transition-colors">
              Hosts
            </Link>
            <Link href="/gallery" className="text-base text-chrome-dim hover:text-white transition-colors">
              Gallery
            </Link>
            <Link href="/leaderboard" className="text-base text-chrome-dim hover:text-white transition-colors">
              Leaderboard
            </Link>
            <Link href="/how-it-works" className="text-base text-chrome-dim hover:text-white transition-colors">
              How It Works
            </Link>
            <Link
              href={
                isConnected && address
                  ? (`/codex/${address}` as Route)
                  : ('/' as Route)
              }
              className="text-base text-chrome-dim hover:text-white transition-colors"
            >
              My Codex
            </Link>
          </div>

          <div className="flex items-center gap-6 font-body">
            <Link
              href="/how-it-works"
              className="hidden sm:block md:hidden text-sm text-chrome-dim hover:text-white transition-colors"
            >
              How It Works
            </Link>
            {isConnected ? (
              <>
                {displayAddress && (
                  <span className="hidden sm:block text-sm text-chrome-dim tracking-wider font-mono">
                    {displayAddress}
                  </span>
                )}
                {balance !== null && (
                  <span className="text-base text-painter">{balance} USDC</span>
                )}
                {username && <span className="text-base text-white/80">@{username}</span>}
                <button
                  onClick={logout}
                  className="text-sm text-chrome-dim hover:text-seer transition-colors"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <Link
                href="/"
                className="text-sm text-chrome-dim hover:text-white transition-colors uppercase tracking-wider"
              >
                Connect
              </Link>
            )}
          </div>
        </div>
      </div>
    </motion.nav>
  )
}
