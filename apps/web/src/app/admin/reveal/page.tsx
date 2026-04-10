'use client'

import { useState, useEffect } from 'react'
import { createSupabaseClient } from '@/lib/supabase'

interface WalletRow {
  id: string
  email: string
  stellar_address: string
}

interface RevealRow {
  wallet_address: string
  display_name: string
}

export default function AdminRevealPage() {
  const [password, setPassword] = useState('')
  const [isAuthed, setIsAuthed] = useState(false)
  const [wallets, setWallets] = useState<WalletRow[]>([])
  const [reveals, setReveals] = useState<RevealRow[]>([])
  const [isRevealed, setIsRevealed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')

  const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD ?? ''

  function handleLogin() {
    if (password === ADMIN_PASSWORD) {
      setIsAuthed(true)
    } else {
      setMessage('Incorrect password.')
    }
  }

  useEffect(() => {
    if (!isAuthed) return

    const supabase = createSupabaseClient()

    Promise.all([
      supabase.from('wallets').select('id, email, stellar_address').order('created_at'),
      supabase.from('reveal_mapping').select('wallet_address, display_name'),
    ]).then(([{ data: w }, { data: r }]) => {
      setWallets((w ?? []) as WalletRow[])
      const existingReveals = (r ?? []) as RevealRow[]
      setReveals(existingReveals)
      setIsRevealed(existingReveals.length > 0)
    })
  }, [isAuthed])

  async function executeReveal() {
    if (isRevealed) return
    setIsLoading(true)

    const supabase = createSupabaseClient()

    // Insert wallet_address → email display name mappings
    const rows = wallets.map((w) => ({
      wallet_address: w.stellar_address,
      display_name: w.email.split('@')[0] ?? w.email,
    }))

    const { error } = await supabase.from('reveal_mapping').insert(rows)

    if (error) {
      setMessage(`Reveal failed: ${error.message}`)
    } else {
      setIsRevealed(true)
      setReveals(rows)
      setMessage(`✓ Reveal complete. ${rows.length} names now visible in the gallery.`)
    }

    setIsLoading(false)
  }

  if (!isAuthed) {
    return (
      <div className="max-w-sm mx-auto px-4 py-20">
        <h1 className="text-2xl font-bold text-navy mb-6 text-center">Admin Access</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          placeholder="Admin password"
          className="w-full border border-navy/20 rounded-lg px-4 py-3 text-sm mb-4 focus:outline-none focus:border-accent"
        />
        {message && <p className="text-red-500 text-xs mb-3">{message}</p>}
        <button
          onClick={handleLogin}
          className="w-full bg-navy text-white py-3 rounded-lg hover:bg-navy/90 transition-colors"
        >
          Login
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold text-navy mb-2">Admin — Gallery Reveal</h1>
      <p className="text-navy/60 text-sm mb-8">
        When you execute the reveal, wallet addresses in the gallery will be replaced with participant names.
        <strong className="text-red-600"> This action is irreversible.</strong>
      </p>

      {/* Wallet mapping table */}
      <div className="bg-white rounded-xl border border-navy/10 overflow-hidden mb-8">
        <div className="px-4 py-3 bg-light-blue border-b border-navy/10">
          <p className="text-sm font-semibold text-navy">{wallets.length} registered wallets</p>
        </div>
        <div className="divide-y divide-navy/5 max-h-80 overflow-y-auto">
          {wallets.map((w) => (
            <div key={w.id} className="flex items-center gap-4 px-4 py-3 text-sm">
              <span className="text-navy/60 w-48 truncate">{w.email}</span>
              <span className="font-mono text-navy/40 text-xs truncate flex-1">{w.stellar_address}</span>
              {reveals.find((r) => r.wallet_address === w.stellar_address) && (
                <span className="text-green-600 text-xs">✓ Revealed</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {message && (
        <div className={`text-sm mb-6 p-3 rounded-lg ${
          message.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {message}
        </div>
      )}

      {isRevealed ? (
        <div className="text-center py-6">
          <p className="text-green-600 font-semibold text-lg">✓ Gallery has been revealed</p>
          <p className="text-navy/50 text-sm mt-1">Participant names are now visible to everyone.</p>
        </div>
      ) : (
        <div className="text-center">
          <button
            onClick={executeReveal}
            disabled={isLoading || wallets.length === 0}
            className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold px-8 py-4 rounded-xl text-lg transition-colors"
          >
            {isLoading ? 'Executing reveal…' : 'Execute Gallery Reveal'}
          </button>
          <p className="text-navy/40 text-xs mt-3">Cannot be undone. Do this at the retreat reveal moment.</p>
        </div>
      )}
    </div>
  )
}
