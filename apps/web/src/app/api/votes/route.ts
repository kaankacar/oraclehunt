import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/server-supabase'

export const runtime = 'nodejs'

interface VoteBody {
  voterAddress?: string
  targetConsultationId?: string
}

export async function POST(request: NextRequest) {
  let body: VoteBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const voterAddress = body.voterAddress?.trim()
  const targetConsultationId = body.targetConsultationId?.trim()

  if (!voterAddress || !targetConsultationId) {
    return NextResponse.json(
      { error: 'voterAddress and targetConsultationId are required' },
      { status: 400 },
    )
  }

  try {
    const supabase = await createServerSupabaseClient()

    const [{ data: voter }, { data: target }] = await Promise.all([
      supabase.from('wallets').select('id').eq('stellar_address', voterAddress).maybeSingle(),
      supabase
        .from('consultations')
        .select('id, wallet_id')
        .eq('id', targetConsultationId)
        .maybeSingle(),
    ])

    if (!voter || !target) {
      return NextResponse.json({ error: 'Wallet or artifact not found' }, { status: 404 })
    }

    if (voter.id === target.wallet_id) {
      return NextResponse.json(
        { error: 'You cannot vote for your own artifact.' },
        { status: 400 },
      )
    }

    const { error } = await supabase.from('votes').insert({
      voter_wallet_id: voter.id,
      target_wallet_id: target.wallet_id,
      target_consultation_id: target.id,
    })

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'You have already voted for this artifact.' },
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
