'use client'

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import {
  clearWalletFromStorage,
  createWallet,
  connectWalletWithOptions,
  getUSDCBalance,
  loadKnownWalletsFromStorage,
  loadWalletFromStorage,
  maybeSeedTestnetWallet,
  saveKnownWalletToStorage,
  saveWalletToStorage,
  truncateAddress,
  type KnownWallet,
  type WalletResult,
} from '@/lib/wallet'

interface WalletContextValue {
  address: string | null
  displayAddress: string | null
  balance: string | null
  username: string | null
  needsProfile: boolean
  knownWallets: KnownWallet[]
  isConnected: boolean
  isLoading: boolean
  connectPasskey: () => Promise<{ requiresUsername: boolean }>
  connectKnownWallet: (wallet: KnownWallet) => Promise<{ requiresUsername: boolean }>
  connectWalletByIdentifier: (identifier: string) => Promise<{ requiresUsername: boolean }>
  createPasskeyWallet: () => Promise<{ requiresUsername: boolean }>
  completeProfile: (username: string) => Promise<void>
  logout: () => void
  refreshBalance: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

interface WalletProfile {
  stellarAddress: string
  keyIdBase64: string | null
  username: string | null
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [pendingWallet, setPendingWallet] = useState<WalletResult | null>(null)
  const [pendingCreatedNewWallet, setPendingCreatedNewWallet] = useState(false)
  const [knownWallets, setKnownWallets] = useState<KnownWallet[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refreshBalance = useCallback(async () => {
    if (!address) return
    const bal = await getUSDCBalance(address)

    if (bal === '0.00') {
      const funded = await maybeSeedTestnetWallet(address)
      if (funded) {
        const fundedBalance = await getUSDCBalance(address)
        setBalance(fundedBalance)
        return
      }
    }

    setBalance(bal)
  }, [address])

  // Restore from localStorage on mount
  useEffect(() => {
    setKnownWallets(loadKnownWalletsFromStorage())
    const stored = loadWalletFromStorage()
    if (stored) {
      setAddress(stored.contractId)
      void (async () => {
        try {
          const response = await fetch('/api/wallet/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stellarAddress: stored.contractId }),
          })

          const json = await response.json() as {
            wallet?: WalletProfile | null
          }

          const existing = json.wallet ?? null
          if (existing?.username) {
            setUsername(existing.username)
            const knownWallet = {
              contractId: stored.contractId,
              keyIdBase64: stored.keyIdBase64,
              username: existing.username,
            }
            saveKnownWalletToStorage(knownWallet)
            setKnownWallets(loadKnownWalletsFromStorage())
          } else {
            setPendingWallet(stored)
          }
        } catch {
          // Ignore startup lookup failures and rely on explicit user actions.
        }
      })()
    }
  }, [])

  // Poll balance every 15 seconds when connected
  useEffect(() => {
    if (!address) return
    refreshBalance()
    const interval = setInterval(refreshBalance, 15_000)
    return () => clearInterval(interval)
  }, [address, refreshBalance])

  const lookupWalletProfileByIdentifier = useCallback(async ({
    stellarAddress,
    username,
  }: {
    stellarAddress?: string
    username?: string
  }) => {
    const response = await fetch('/api/wallet/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stellarAddress, username }),
    })

    const json = await response.json() as {
      wallet?: WalletProfile | null
      error?: string
    }

    if (!response.ok) {
      throw new Error(json.error ?? 'Failed to look up wallet')
    }

    return json.wallet ?? null
  }, [])

  const lookupWalletProfile = useCallback(async (stellarAddress: string) => {
    return await lookupWalletProfileByIdentifier({ stellarAddress })
  }, [lookupWalletProfileByIdentifier])

  const registerWallet = useCallback(async (nextUsername: string, wallet: WalletResult) => {
    const response = await fetch('/api/wallet/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: nextUsername,
        stellarAddress: wallet.contractId,
        keyIdBase64: wallet.keyIdBase64,
      }),
    })

    const json = await response.json() as {
      error?: string
      wallet?: { username: string }
    }
    if (!response.ok) {
      throw new Error(json.error ?? 'Failed to register wallet')
    }

    return json.wallet?.username ?? nextUsername
  }, [])

  const finalizeWalletSession = useCallback(async (
    wallet: WalletResult,
    nextUsername: string,
    createdNewWallet: boolean,
  ) => {
    saveWalletToStorage(wallet.contractId, wallet.keyIdBase64)
    saveKnownWalletToStorage({
      contractId: wallet.contractId,
      keyIdBase64: wallet.keyIdBase64,
      username: nextUsername,
    })
    setKnownWallets(loadKnownWalletsFromStorage())
    setPendingWallet(null)
    setPendingCreatedNewWallet(false)
    setUsername(nextUsername)
    setAddress(wallet.contractId)

    if (createdNewWallet) {
      const funded = await maybeSeedTestnetWallet(wallet.contractId)
      if (funded) {
        const fundedBalance = await getUSDCBalance(wallet.contractId)
        setBalance(fundedBalance)
      }
    }
  }, [])

  const prepareWalletSession = useCallback(async (
    wallet: WalletResult,
    createdNewWallet: boolean,
  ) => {
    const existing = await lookupWalletProfile(wallet.contractId)

    if (existing?.username) {
      const registeredUsername = await registerWallet(existing.username, wallet)
      await finalizeWalletSession(wallet, registeredUsername, createdNewWallet)
      return { requiresUsername: false }
    }

    setPendingWallet(wallet)
    setPendingCreatedNewWallet(createdNewWallet)
    setAddress(wallet.contractId)
    setBalance(null)
    setUsername(null)
    return { requiresUsername: true }
  }, [finalizeWalletSession, lookupWalletProfile, registerWallet])

  const connectPasskey = useCallback(async () => {
    setIsLoading(true)
    try {
      const stored = loadWalletFromStorage()
      if (stored) {
        return await prepareWalletSession(stored, false)
      }

      const savedWallets = loadKnownWalletsFromStorage()
      if (savedWallets.length === 1) {
        const known = savedWallets[0]
        if (known) {
          const result = await connectWalletWithOptions({
            keyId: known.keyIdBase64,
            getContractId: async () => known.contractId,
          })
          return await prepareWalletSession(result, false)
        }
      }

      const result = await connectWalletWithOptions()
      return await prepareWalletSession(result, false)
    } finally {
      setIsLoading(false)
    }
  }, [prepareWalletSession])

  const connectKnownWallet = useCallback(async (wallet: KnownWallet) => {
    setIsLoading(true)
    try {
      const result = await connectWalletWithOptions({
        keyId: wallet.keyIdBase64,
        getContractId: async () => wallet.contractId,
      })
      return await prepareWalletSession(result, false)
    } finally {
      setIsLoading(false)
    }
  }, [prepareWalletSession])

  const connectWalletByIdentifier = useCallback(async (identifier: string) => {
    const normalized = identifier.trim()
    if (!normalized) {
      throw new Error('Enter a username or wallet address.')
    }

    setIsLoading(true)
    try {
      const wallet = normalized.startsWith('C')
        ? await lookupWalletProfileByIdentifier({ stellarAddress: normalized })
        : await lookupWalletProfileByIdentifier({ username: normalized.toLowerCase().replace(/^@/, '') })

      if (!wallet) {
        throw new Error('No wallet found for that username or address.')
      }

      const connectOptions = {
        getContractId: async () => wallet.stellarAddress,
      } as {
        keyId?: string
        getContractId: () => Promise<string>
      }

      if (wallet.keyIdBase64) {
        connectOptions.keyId = wallet.keyIdBase64
      }

      const result = await connectWalletWithOptions(connectOptions)
      return await prepareWalletSession(result, false)
    } finally {
      setIsLoading(false)
    }
  }, [lookupWalletProfileByIdentifier, prepareWalletSession])

  const createPasskeyWallet = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await createWallet('Oracle Hunt', 'oracle-hunt')
      return await prepareWalletSession(result, true)
    } finally {
      setIsLoading(false)
    }
  }, [prepareWalletSession])

  const completeProfile = useCallback(async (nextUsername: string) => {
    if (!pendingWallet) {
      throw new Error('No wallet is waiting for profile setup.')
    }

    setIsLoading(true)
    try {
      const registeredUsername = await registerWallet(nextUsername, pendingWallet)
      await finalizeWalletSession(pendingWallet, registeredUsername, pendingCreatedNewWallet)
    } finally {
      setIsLoading(false)
    }
  }, [finalizeWalletSession, pendingCreatedNewWallet, pendingWallet, registerWallet])

  const logout = useCallback(() => {
    setAddress(null)
    setBalance(null)
    setUsername(null)
    setPendingWallet(null)
    setPendingCreatedNewWallet(false)
    clearWalletFromStorage()
  }, [])

  return (
    <WalletContext.Provider
      value={{
        address,
        displayAddress: address ? truncateAddress(address) : null,
        balance,
        username,
        needsProfile: !!pendingWallet,
        knownWallets,
        isConnected: !!address,
        isLoading,
        connectPasskey,
        connectKnownWallet,
        connectWalletByIdentifier,
        createPasskeyWallet,
        completeProfile,
        logout,
        refreshBalance,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within WalletProvider')
  return ctx
}
