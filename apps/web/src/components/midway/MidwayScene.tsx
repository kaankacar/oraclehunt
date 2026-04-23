'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import dynamic from 'next/dynamic'
import BoothGrid from './BoothGrid'
import MidwayNav from './MidwayNav'
import Scanlines from '@/components/effects/Scanlines'
import { useWallet } from '@/components/WalletProvider'
import { getConsultedOracles } from '@/lib/supabase'
import { PROGRESS_ORACLE_IDS, isProgressOracleId } from '@/types'

const ParticleField = dynamic(() => import('@/components/effects/ParticleField'), { ssr: false })

export default function MidwayScene() {
  const { address, isConnected } = useWallet()
  const [consulted, setConsulted] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!address) return
    getConsultedOracles(address).then(setConsulted)
  }, [address])

  const completionCount = Array.from(consulted).filter(isProgressOracleId).length

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/images/background_midway.png')" }}
      />

      <div className="fixed inset-0 bg-gradient-to-b from-midnight/60 via-midnight/40 to-midnight/80" />
      <div className="fixed inset-0 bg-gradient-to-r from-midnight/50 via-transparent to-midnight/50" />

      <div className="fixed inset-0 pointer-events-none">
        <ParticleField variant="fog" color="#1a1025" opacity={0.3} />
      </div>
      <div className="fixed inset-0 pointer-events-none">
        <ParticleField variant="dust" color="#9d4edd" opacity={0.4} />
      </div>

      <Scanlines className="fixed" opacity={0.02} />

      <div className="relative z-10">
        <MidwayNav />

        <motion.header
          className="pt-24 pb-8 text-center"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.6, 0.01, 0.05, 0.95] as const }}
        >
          <h1
            className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-[0.1em] mb-2 font-title"
            style={{
              color: 'rgba(255,255,255,0.9)',
              textShadow: '0 2px 20px rgba(0,0,0,0.9), 0 0 40px rgba(157,78,221,0.3)',
            }}
          >
            The Midnight Midway
          </h1>

          <p className="font-title text-white/90 text-lg max-w-xl mx-auto tracking-[0.05em]">
            Explore seven interactive Midway Hosts, each triggered by an x402-powered payment flow.
          </p>

          {isConnected && (
            <p className="font-body text-white/80 text-sm mt-3">
              Codex progress:{' '}
              <span className="text-composer font-semibold">
                {completionCount} / {PROGRESS_ORACLE_IDS.length}
              </span>{' '}
              core hosts
            </p>
          )}

          <motion.div
            className="mx-auto mt-6 h-px w-48 bg-gradient-to-r from-transparent via-composer to-transparent"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          />
        </motion.header>

        <main className="py-8 pb-24">
          <BoothGrid consulted={consulted} />
        </main>

      </div>

      <div className="fixed top-4 left-4 w-12 h-12 border-l border-t border-chrome/10 pointer-events-none" />
      <div className="fixed top-4 right-4 w-12 h-12 border-r border-t border-chrome/10 pointer-events-none" />
      <div className="fixed bottom-4 left-4 w-12 h-12 border-l border-b border-chrome/10 pointer-events-none" />
      <div className="fixed bottom-4 right-4 w-12 h-12 border-r border-b border-chrome/10 pointer-events-none" />

      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 0%, rgba(10,10,18,0.3) 70%, rgba(10,10,18,0.7) 100%)',
        }}
      />
    </div>
  )
}
