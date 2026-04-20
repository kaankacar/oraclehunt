'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/components/WalletProvider'
import { truncateAddress } from '@/lib/wallet'

const IS_MAINNET = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'

export default function LandingPage() {
  const {
    address,
    username,
    needsProfile,
    knownWallets,
    connectPasskey,
    connectKnownWallet,
    connectWalletByIdentifier,
    createPasskeyWallet,
    completeProfile,
    isConnected,
    isLoading,
  } = useWallet()
  const [nextUsername, setNextUsername] = useState('')
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('')
  const [error, setError] = useState('')
  const [activeAction, setActiveAction] = useState<'connect' | 'create' | 'profile' | 'recover' | null>(null)
  const router = useRouter()

  async function handleConnect() {
    if (isConnected && !needsProfile) {
      router.push('/marketplace')
      return
    }

    setError('')
    setActiveAction('connect')
    try {
      const result = await connectPasskey()
      if (!result.requiresUsername) {
        router.push('/marketplace')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect passkey wallet.')
    } finally {
      setActiveAction(null)
    }
  }

  async function handleCreate() {
    setError('')
    setActiveAction('create')
    try {
      const result = await createPasskeyWallet()
      if (!result.requiresUsername) {
        router.push('/marketplace')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create passkey wallet.')
    } finally {
      setActiveAction(null)
    }
  }

  async function handleKnownWalletConnect(contractId: string) {
    const wallet = knownWallets.find((entry) => entry.contractId === contractId)
    if (!wallet) return

    setError('')
    setActiveAction('connect')
    try {
      const result = await connectKnownWallet(wallet)
      if (!result.requiresUsername) {
        router.push('/marketplace')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reconnect wallet.')
    } finally {
      setActiveAction(null)
    }
  }

  async function handleCompleteProfile() {
    if (!nextUsername.trim()) {
      setError('Choose a public username.')
      return
    }

    setError('')
    setActiveAction('profile')
    try {
      await completeProfile(nextUsername)
      router.push('/marketplace')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save username.')
    } finally {
      setActiveAction(null)
    }
  }

  async function handleRecoveryConnect() {
    if (!recoveryIdentifier.trim()) {
      setError('Enter your username or wallet address.')
      return
    }

    setError('')
    setActiveAction('recover')
    try {
      const result = await connectWalletByIdentifier(recoveryIdentifier)
      if (!result.requiresUsername) {
        router.push('/marketplace')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reconnect wallet.')
    } finally {
      setActiveAction(null)
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

        {needsProfile ? (
          <div className="bg-white/10 backdrop-blur rounded-2xl p-8 border border-white/20">
            <p className="text-white/80 text-sm mb-2">
              Your wallet is connected. Choose the public username that will appear in the leaderboard and gallery.
            </p>
            {address && (
              <p className="text-white/40 text-xs font-mono mb-4">
                {truncateAddress(address)}
              </p>
            )}
            <input
              type="text"
              placeholder="choose-a-username"
              value={nextUsername}
              onChange={(e) => setNextUsername(e.target.value.toLowerCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleCompleteProfile()}
              className="w-full bg-white/10 border border-white/30 text-white placeholder-white/40 rounded-lg px-4 py-3 text-sm mb-4 focus:outline-none focus:border-accent-light"
            />
            {error && <p className="text-red-400 text-xs mb-4">{error}</p>}
            <button
              onClick={handleCompleteProfile}
              disabled={isLoading}
              className="w-full bg-accent hover:bg-accent-light disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {isLoading && activeAction === 'profile' ? 'Saving username…' : 'Join Oracle Hunt'}
            </button>
            <p className="text-white/40 text-xs mt-4">
              Usernames are public. Use lowercase letters, numbers, hyphens, or underscores.
            </p>
          </div>
        ) : !isConnected ? (
          <div className="bg-white/10 backdrop-blur rounded-2xl p-8 border border-white/20">
            <p className="text-white/80 text-sm mb-4">
              Connect an existing passkey wallet, or create one if you are new.
            </p>
            {error && <p className="text-red-400 text-xs mb-4">{error}</p>}
            <div className="space-y-3">
              <button
                onClick={handleConnect}
                disabled={isLoading}
                className="w-full bg-accent hover:bg-accent-light disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {isLoading && activeAction === 'connect' ? 'Connecting wallet…' : 'Connect Passkey Wallet'}
              </button>
              <button
                onClick={handleCreate}
                disabled={isLoading}
                className="w-full border border-white/25 text-white hover:bg-white/10 disabled:opacity-50 font-semibold py-3 rounded-lg transition-colors"
              >
                {isLoading && activeAction === 'create' ? 'Creating wallet…' : 'Create New Wallet'}
              </button>
            </div>
            {knownWallets.length > 0 && (
              <div className="mt-6 text-left">
                <p className="text-white/50 text-xs uppercase tracking-wide mb-3">
                  Recent wallets on this device
                </p>
                <div className="space-y-2">
                  {knownWallets.map((wallet) => (
                    <button
                      key={wallet.contractId}
                      onClick={() => handleKnownWalletConnect(wallet.contractId)}
                      disabled={isLoading}
                      className="w-full flex items-center justify-between rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-left hover:bg-white/10 disabled:opacity-50 transition-colors"
                    >
                      <span className="min-w-0">
                        <span className="block text-white text-sm">
                          {wallet.username ? `@${wallet.username}` : 'Unnamed wallet'}
                        </span>
                        <span className="block text-white/40 text-xs font-mono">
                          {truncateAddress(wallet.contractId)}
                        </span>
                      </span>
                      <span className="text-accent-light text-xs">Reconnect</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-6 text-left">
              <p className="text-white/50 text-xs uppercase tracking-wide mb-3">
                Recovery
              </p>
              <input
                type="text"
                placeholder="@username or C..."
                value={recoveryIdentifier}
                onChange={(e) => setRecoveryIdentifier(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRecoveryConnect()}
                className="w-full bg-white/10 border border-white/30 text-white placeholder-white/40 rounded-lg px-4 py-3 text-sm mb-3 focus:outline-none focus:border-accent-light"
              />
              <button
                onClick={handleRecoveryConnect}
                disabled={isLoading}
                className="w-full border border-white/20 text-white hover:bg-white/10 disabled:opacity-50 font-semibold py-3 rounded-lg transition-colors"
              >
                {isLoading && activeAction === 'recover' ? 'Reconnecting…' : 'Reconnect by Username or Wallet'}
              </button>
              <p className="text-white/35 text-xs mt-3">
                Use this if the generic passkey connect does not bring up the right wallet.
              </p>
            </div>
            <p className="text-white/40 text-xs mt-4">
              Uses your device biometrics. No password required.
              {!IS_MAINNET ? ' New testnet wallets receive 2 USDC automatically.' : ''}
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-white/70 text-sm mb-6">
              Welcome back{username ? `, ${username}` : ', seeker'}.
            </p>
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
