'use client'

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import {
  createWallet,
  connectWalletWithOptions,
  getUSDCBalance,
  loadWalletFromStorage,
  maybeSeedTestnetWallet,
  saveWalletToStorage,
  truncateAddress,
  type WalletResult,
} from '@/lib/wallet'

interface WalletContextValue {
  address: string | null
  displayAddress: string | null
  balance: string | null
  isConnected: boolean
  isLoading: boolean
  login: (email: string) => Promise<void>
  logout: () => void
  refreshBalance: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
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
    const stored = loadWalletFromStorage()
    if (stored) {
      setAddress(stored.contractId)
    }
  }, [])

  // Poll balance every 15 seconds when connected
  useEffect(() => {
    if (!address) return
    refreshBalance()
    const interval = setInterval(refreshBalance, 15_000)
    return () => clearInterval(interval)
  }, [address, refreshBalance])

  const lookupWalletByEmail = useCallback(async (email: string) => {
    const response = await fetch('/api/wallet/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })

    const json = await response.json() as {
      wallet?: { stellarAddress: string; keyIdBase64: string | null } | null
      error?: string
    }

    if (!response.ok) {
      throw new Error(json.error ?? 'Failed to look up wallet')
    }

    return json.wallet ?? null
  }, [])

  const registerWallet = useCallback(async (email: string, wallet: WalletResult) => {
    const response = await fetch('/api/wallet/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        stellarAddress: wallet.contractId,
        keyIdBase64: wallet.keyIdBase64,
      }),
    })

    const json = await response.json() as { error?: string }
    if (!response.ok) {
      throw new Error(json.error ?? 'Failed to register wallet')
    }
  }, [])

  const login = useCallback(async (email: string) => {
    setIsLoading(true)
    try {
      let result: WalletResult
      let createdNewWallet = false
      const normalizedEmail = email.trim().toLowerCase()
      const linkedWallet = await lookupWalletByEmail(normalizedEmail)

      const stored = loadWalletFromStorage()

      if (linkedWallet) {
        if (stored && stored.contractId === linkedWallet.stellarAddress) {
          result = stored
        } else {
          try {
            result = linkedWallet.keyIdBase64
              ? await connectWalletWithOptions({
                  keyId: linkedWallet.keyIdBase64,
                  getContractId: async () => linkedWallet.stellarAddress,
                })
              : await connectWalletWithOptions({
                  getContractId: async () => linkedWallet.stellarAddress,
                })
          } catch {
            throw new Error(
              'This email already has a wallet. Use the original passkey for that wallet instead of creating a new one.',
            )
          }
        }
      } else if (stored) {
        result = stored
      } else {
        try {
          result = await connectWalletWithOptions()
        } catch (error) {
          const message = error instanceof Error ? error.message : ''
          if (message && message !== 'Failed to connect wallet') {
            throw error
          }

          result = await createWallet('Oracle Hunt', normalizedEmail)
          createdNewWallet = true
        }
      }

      await registerWallet(normalizedEmail, result)

      saveWalletToStorage(result.contractId, result.keyIdBase64)
      setAddress(result.contractId)

      if (createdNewWallet) {
        const funded = await maybeSeedTestnetWallet(result.contractId)
        if (funded) {
          const fundedBalance = await getUSDCBalance(result.contractId)
          setBalance(fundedBalance)
        }
      }
    } finally {
      setIsLoading(false)
    }
  }, [lookupWalletByEmail, registerWallet])

  const logout = useCallback(() => {
    setAddress(null)
    setBalance(null)
    if (typeof window !== 'undefined') {
      localStorage.removeItem('oraclehunt_wallet')
    }
  }, [])

  return (
    <WalletContext.Provider
      value={{
        address,
        displayAddress: address ? truncateAddress(address) : null,
        balance,
        isConnected: !!address,
        isLoading,
        login,
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
