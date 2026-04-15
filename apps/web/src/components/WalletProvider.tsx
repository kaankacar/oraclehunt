'use client'

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import {
  createWallet,
  connectWallet,
  getUSDCBalance,
  loadWalletFromStorage,
  maybeSeedTestnetWallet,
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

  const login = useCallback(async (email: string) => {
    setIsLoading(true)
    try {
      let result: WalletResult
      let createdNewWallet = false

      // If a wallet is already stored locally, reuse it — no passkey prompt needed.
      // This prevents a new passkey/wallet from being created on every login.
      const stored = loadWalletFromStorage()
      if (stored) {
        result = stored
      } else {
        // No local wallet: try to connect an existing passkey, create one if none found.
        try {
          result = await connectWallet()
        } catch {
          result = await createWallet('Oracle Hunt', email)
          createdNewWallet = true
        }
      }

      // Always upsert so the Supabase row exists regardless of how we got here.
      const supabase = createSupabaseClient()
      await supabase.from('wallets').upsert(
        { email, stellar_address: result.contractId },
        { onConflict: 'stellar_address' },
      )

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
