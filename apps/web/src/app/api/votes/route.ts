import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/server-supabase'

export const runtime = 'nodejs'

interface VoteBody {
  voterAddress?: string
  targetAddress?: string
}

export async function POST(request: NextRequest) {
  let body: VoteBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const voterAddress = body.voterAddress?.trim()
  const targetAddress = body.targetAddress?.trim()

  if (!voterAddress || !targetAddress) {
    return NextResponse.json(
      { error: 'voterAddress and targetAddress are required' },
      { status: 400 },
    )
  }

  try {
    const supabase = await createServerSupabaseClient()

    const [{ data: voter }, { data: target }] = await Promise.all([
      supabase.from('wallets').select('id').eq('stellar_address', voterAddress).maybeSingle(),
      supabase.from('wallets').select('id').eq('stellar_address', targetAddress).maybeSingle(),
    ])

    if (!voter || !target) {
      return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
    }

    if (voter.id === target.id) {
      return NextResponse.json(
        { error: 'You cannot vote for your own Codex.' },
        { status: 400 },
      )
    }

    const { error } = await supabase.from('votes').insert({
      voter_wallet_id: voter.id,
      target_wallet_id: target.id,
    })

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'You have already voted for this Codex.' },
          { status: 409 },
        )
      }

      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Vote failed' },
      { status: 500 },
    )
  }
}
