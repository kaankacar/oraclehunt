import { NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/admin-auth'
import { createServerSupabaseClient } from '@/lib/server-supabase'

export const runtime = 'nodejs'

async function loadRevealState() {
  const supabase = await createServerSupabaseClient()
  const [{ data: wallets, error: walletsError }, { data: reveals, error: revealsError }] = await Promise.all([
    supabase.from('wallets').select('id, username, stellar_address').order('created_at'),
    supabase.from('reveal_mapping').select('wallet_address, display_name'),
  ])

  if (walletsError) throw new Error(walletsError.message)
  if (revealsError) throw new Error(revealsError.message)

  return {
    wallets: wallets ?? [],
    reveals: reveals ?? [],
  }
}

export async function GET() {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const state = await loadRevealState()
    return NextResponse.json(state)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load reveal state' },
      { status: 500 },
    )
  }
}

export async function POST() {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = await createServerSupabaseClient()
    const { wallets, reveals } = await loadRevealState()

    if (reveals.length > 0) {
      return NextResponse.json({
        ok: true,
        message: 'Gallery has already been revealed.',
        wallets,
        reveals,
      })
    }

    const rows = wallets.map((wallet) => ({
      wallet_address: wallet.stellar_address,
      display_name: wallet.username ?? wallet.stellar_address.slice(0, 10),
    }))

    const { error } = await supabase.from('reveal_mapping').insert(rows)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      message: `Reveal complete. ${rows.length} usernames now visible in the gallery.`,
      wallets,
      reveals: rows,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reveal failed' },
      { status: 500 },
    )
  }
}
