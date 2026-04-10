'use client'

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import {
  createWallet,
  connectWallet,
  getUSDCBalance,
  loadWalletFromStorage,
  saveWalletToStorage,
  truncateAddress,
  type WalletResult,
} from '@/lib/wallet'
import { createSupabaseClient } from '@/lib/supabase'

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

  const login = useCallback(async (email: string) => {
    setIsLoading(true)
    try {
      let result: WalletResult

      // Try to connect existing wallet first; create new one if none exists
      try {
        result = await connectWallet()
      } catch {
        result = await createWallet('Oracle Hunt', email)

        // Register wallet in Supabase
        const supabase = createSupabaseClient()
        await supabase.from('wallets').upsert(
          { email, stellar_address: result.contractId },
          { onConflict: 'email' },
        )
      }

      saveWalletToStorage(result.contractId, result.keyIdBase64)
      setAddress(result.contractId)
    } finally {
      setIsLoading(false)
    }
  }, [])

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
