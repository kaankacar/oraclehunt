'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { useWallet } from '@/components/WalletProvider'
import { truncateAddress } from '@/lib/wallet'

const IS_MAINNET = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'

export default function LandingPage() {
  const router = useRouter()
  const {
    address,
    username,
    needsProfile,
    knownWallets,
    connectPasskey,
    connectKnownWallet,
    createPasskeyWallet,
    completeProfile,
    isConnected,
    isLoading,
  } = useWallet()

  const [showGate, setShowGate] = useState(false)
  const [videoEnded, setVideoEnded] = useState(false)
  const [nextUsername, setNextUsername] = useState('')
  const [error, setError] = useState('')
  const [activeAction, setActiveAction] = useState<'connect' | 'create' | 'profile' | null>(null)

  const hoverSoundRef = useRef<HTMLAudioElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const playHoverSound = useCallback(() => {
    if (!hoverSoundRef.current) {
      hoverSoundRef.current = new Audio('/sounds/crystal_synth.mp3')
      hoverSoundRef.current.volume = 0.5
    }
    hoverSoundRef.current.currentTime = 0
    hoverSoundRef.current.play().catch(() => {})
  }, [])

  const handleVideoEnd = useCallback(() => {
    setVideoEnded(true)
  }, [])

  const handleEnter = useCallback(() => {
    setShowGate(true)
  }, [])

  async function handleConnect() {
    if (isConnected && !needsProfile) {
      router.push('/marketplace')
      return
    }
    setError('')
    setActiveAction('connect')
    try {
      const result = await connectPasskey()
      if (!result.requiresUsername) router.push('/marketplace')
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
      if (!result.requiresUsername) router.push('/marketplace')
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
      if (!result.requiresUsername) router.push('/marketplace')
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

  return (
    <div className="fixed inset-0 overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        onEnded={handleVideoEnd}
        className="absolute inset-0 h-full w-full object-cover"
        poster="/images/carnival-entrance-poster.png"
      >
        <source src="/videos/carnival_entrance.mp4" type="video/mp4" />
      </video>

      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(5,2,10,0.4) 0%, rgba(5,2,10,0.2) 30%, rgba(5,2,10,0.2) 60%, rgba(5,2,10,0.6) 100%)',
        }}
      />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{ boxShadow: 'inset 0 0 200px 80px rgba(5,2,10,0.7)' }}
      />

      <div className="relative z-10 flex h-full flex-col items-center justify-end pb-16 md:pb-24 px-6">
        <motion.h1
          className="relative text-center mb-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.5, delay: 0.5 }}
        >
          {[...Array(8)].map((_, i) => (
            <motion.span
              key={i}
              className="absolute w-1 h-1 bg-white rounded-full"
              style={{
                left: `${10 + i * 12}%`,
                top: `${i % 2 === 0 ? -10 : 110}%`,
                boxShadow: '0 0 6px 2px rgba(255,255,255,0.8), 0 0 12px 4px rgba(157,78,221,0.5)',
              }}
              animate={{
                opacity: [0, 1, 0],
                scale: [0, 1, 0],
                y: [0, i % 2 === 0 ? -8 : 8, 0],
              }}
              transition={{
                duration: 2 + i * 0.2,
                repeat: Infinity,
                delay: i * 0.3,
                ease: 'easeInOut',
              }}
            />
          ))}
          <span
            className="block text-3xl md:text-4xl lg:text-5xl font-semibold tracking-[0.15em] font-title"
            style={{
              color: 'rgba(255,255,255,0.9)',
              textShadow: '0 2px 20px rgba(0,0,0,0.9), 0 0 40px rgba(157,78,221,0.3)',
            }}
          >
            Midnight Midway
          </span>
        </motion.h1>

        <motion.p
          className="text-center font-body text-sm md:text-base max-w-md mb-8"
          style={{
            color: 'rgba(255,255,255,0.5)',
            textShadow: '0 2px 12px rgba(0,0,0,0.9)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.5, delay: 1 }}
        >
          Seven hosts await beyond the threshold
        </motion.p>

        <AnimatePresence mode="wait">
          {!showGate && videoEnded && (
            <motion.button
              key="enter-button"
              onClick={handleEnter}
              onMouseEnter={playHoverSound}
              className="group relative px-12 py-4 font-body text-xs tracking-[0.25em] uppercase"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <EnterFrame />
              <span
                className="relative z-10 font-bold transition-colors duration-500 group-hover:text-white/90"
                style={{ color: 'rgba(255,255,255,0.7)' }}
              >
                Enter
              </span>
            </motion.button>
          )}

          {showGate && (
            <motion.div
              key="wallet-gate"
              className="w-full max-w-md"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
            >
              {needsProfile ? (
                <div className="space-y-3 text-center">
                  <p className="font-body text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    Your wallet is connected. Choose a public username.
                  </p>
                  {address && (
                    <p className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {truncateAddress(address)}
                    </p>
                  )}
                  <input
                    type="text"
                    placeholder="choose-a-username"
                    value={nextUsername}
                    onChange={(e) => setNextUsername(e.target.value.toLowerCase())}
                    onKeyDown={(e) => e.key === 'Enter' && handleCompleteProfile()}
                    className="w-full bg-white/5 border border-white/20 text-white placeholder-white/30 px-4 py-3 text-sm font-body backdrop-blur-sm focus:outline-none focus:border-white/50"
                  />
                  {error && <p className="text-red-400 text-xs">{error}</p>}
                  <GateButton
                    onClick={handleCompleteProfile}
                    onMouseEnter={playHoverSound}
                    disabled={isLoading}
                    label={isLoading && activeAction === 'profile' ? 'Saving…' : 'Join Oracle Hunt'}
                  />
                </div>
              ) : !isConnected ? (
                <div className="space-y-3">
                  {error && <p className="text-red-400 text-xs text-center">{error}</p>}
                  <GateButton
                    onClick={handleConnect}
                    onMouseEnter={playHoverSound}
                    disabled={isLoading}
                    label={isLoading && activeAction === 'connect' ? 'Connecting…' : 'Connect Passkey Wallet'}
                  />
                  <GateButton
                    onClick={handleCreate}
                    onMouseEnter={playHoverSound}
                    disabled={isLoading}
                    label={isLoading && activeAction === 'create' ? 'Creating…' : 'Create New Wallet'}
                  />
                  {knownWallets.length > 0 && (
                    <div className="pt-4 space-y-2">
                      <p
                        className="text-center font-body text-[10px] uppercase tracking-[0.25em]"
                        style={{ color: 'rgba(255,255,255,0.4)' }}
                      >
                        Recent wallets
                      </p>
                      {knownWallets.map((wallet) => (
                        <button
                          key={wallet.contractId}
                          onClick={() => handleKnownWalletConnect(wallet.contractId)}
                          disabled={isLoading}
                          className="w-full flex items-center justify-between px-4 py-2 border border-white/10 bg-white/5 backdrop-blur-sm text-left hover:bg-white/10 disabled:opacity-50 transition-colors"
                        >
                          <span className="min-w-0">
                            <span className="block text-white/80 text-sm font-body">
                              {wallet.username ? `@${wallet.username}` : 'Unnamed wallet'}
                            </span>
                            <span className="block text-white/40 text-xs font-mono">
                              {truncateAddress(wallet.contractId)}
                            </span>
                          </span>
                          <span className="text-white/60 text-xs uppercase tracking-wider">Reconnect</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p
                    className="text-center font-body text-[10px] uppercase tracking-[0.25em] pt-2"
                    style={{ color: 'rgba(255,255,255,0.3)' }}
                  >
                    Uses your device biometrics
                    {!IS_MAINNET ? ' · testnet wallets receive 2 USDC' : ''}
                  </p>
                </div>
              ) : (
                <div className="text-center space-y-4">
                  <p className="font-body text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    Welcome back{username ? `, ${username}` : ', seeker'}.
                  </p>
                  <GateButton
                    onClick={() => router.push('/marketplace')}
                    onMouseEnter={playHoverSound}
                    label="Enter the Oracle Market"
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function EnterFrame() {
  return (
    <>
      <div
        className="absolute inset-0 transition-all duration-500"
        style={{ border: '1px solid rgba(255,255,255,0.15)' }}
      />
      <div
        className="absolute inset-[4px] transition-all duration-500"
        style={{ border: '1px solid rgba(255,255,255,0.25)' }}
      />
      <div className="absolute top-0 left-0 w-4 h-4">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-white/60 to-transparent" />
        <div className="absolute top-0 left-0 h-full w-[1px] bg-gradient-to-b from-white/60 to-transparent" />
        <div className="absolute top-[2px] left-[2px] w-1 h-1 bg-white/40 rounded-full" />
      </div>
      <div className="absolute top-0 right-0 w-4 h-4">
        <div className="absolute top-0 right-0 w-full h-[1px] bg-gradient-to-l from-white/60 to-transparent" />
        <div className="absolute top-0 right-0 h-full w-[1px] bg-gradient-to-b from-white/60 to-transparent" />
        <div className="absolute top-[2px] right-[2px] w-1 h-1 bg-white/40 rounded-full" />
      </div>
      <div className="absolute bottom-0 left-0 w-4 h-4">
        <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-white/60 to-transparent" />
        <div className="absolute bottom-0 left-0 h-full w-[1px] bg-gradient-to-t from-white/60 to-transparent" />
        <div className="absolute bottom-[2px] left-[2px] w-1 h-1 bg-white/40 rounded-full" />
      </div>
      <div className="absolute bottom-0 right-0 w-4 h-4">
        <div className="absolute bottom-0 right-0 w-full h-[1px] bg-gradient-to-l from-white/60 to-transparent" />
        <div className="absolute bottom-0 right-0 h-full w-[1px] bg-gradient-to-t from-white/60 to-transparent" />
        <div className="absolute bottom-[2px] right-[2px] w-1 h-1 bg-white/40 rounded-full" />
      </div>
      <div className="absolute top-1/2 left-0 w-2 h-[1px] -translate-y-1/2 bg-gradient-to-r from-white/40 to-transparent" />
      <div className="absolute top-1/2 right-0 w-2 h-[1px] -translate-y-1/2 bg-gradient-to-l from-white/40 to-transparent" />
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ boxShadow: '0 0 30px rgba(157,78,221,0.3), inset 0 0 20px rgba(157,78,221,0.1)' }}
      />
    </>
  )
}

function GateButton({
  onClick,
  onMouseEnter,
  disabled,
  label,
}: {
  onClick: () => void
  onMouseEnter?: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      disabled={disabled}
      className="group relative w-full px-12 py-4 font-body text-xs tracking-[0.25em] uppercase disabled:opacity-50"
    >
      <EnterFrame />
      <span
        className="relative z-10 font-bold transition-colors duration-500 group-hover:text-white/90"
        style={{ color: 'rgba(255,255,255,0.7)' }}
      >
        {label}
      </span>
    </button>
  )
}
