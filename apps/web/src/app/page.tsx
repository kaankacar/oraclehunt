'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletProvider'

export default function LandingPage() {
  const { login, isConnected, isLoading, address } = useWallet()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleEnter() {
    if (isConnected) {
      router.push('/marketplace')
      return
    }

    if (!email.includes('@')) {
      setError('Please enter your SDF email address.')
      return
    }

    setError('')
    try {
      await login(email)
      router.push('/marketplace')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-navy flex flex-col items-center justify-center px-4">
      {/* Star field effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 60 }).map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-white/20 rounded-full"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              opacity: Math.random() * 0.5 + 0.1,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 text-center max-w-lg">
        <div className="text-6xl mb-6">🔮</div>
        <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">Oracle Hunt</h1>
        <p className="text-white/70 text-lg mb-2">
          Six Oracles await your questions.
        </p>
        <p className="text-white/50 text-sm mb-12">
          Pay. Ask. Collect. Find the one that is hidden.
        </p>

        {!isConnected ? (
          <div className="bg-white/10 backdrop-blur rounded-2xl p-8 border border-white/20">
            <p className="text-white/80 text-sm mb-4">
              Enter your SDF email to create your passkey wallet
            </p>
            <input
              type="email"
              placeholder="you@stellar.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleEnter()}
              className="w-full bg-white/10 border border-white/30 text-white placeholder-white/40 rounded-lg px-4 py-3 text-sm mb-4 focus:outline-none focus:border-accent-light"
            />
            {error && <p className="text-red-400 text-xs mb-4">{error}</p>}
            <button
              onClick={handleEnter}
              disabled={isLoading}
              className="w-full bg-accent hover:bg-accent-light disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {isLoading ? 'Creating wallet…' : 'Enter Oracle Hunt'}
            </button>
            <p className="text-white/40 text-xs mt-4">
              Uses your device biometrics. No password required.
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-white/70 text-sm mb-6">Welcome back, seeker.</p>
            <button
              onClick={() => router.push('/marketplace')}
              className="bg-accent hover:bg-accent-light text-white font-semibold px-8 py-3 rounded-lg transition-colors"
            >
              Enter the Oracle Market
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
