import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/server-supabase'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  let body: { stellarAddress?: string; username?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const stellarAddress = body.stellarAddress?.trim()
  const username = body.username?.trim().toLowerCase()
  if (!stellarAddress && !username) {
    return NextResponse.json({ error: 'stellarAddress or username is required' }, { status: 400 })
  }

  try {
    const supabase = await createServerSupabaseClient()
    const query = supabase
      .from('wallets')
      .select('stellar_address, key_id_base64, username')

    const { data, error } = stellarAddress
      ? await query.eq('stellar_address', stellarAddress).maybeSingle()
      : await query.eq('username', username!).maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      wallet: data
        ? {
            stellarAddress: data.stellar_address,
            keyIdBase64: data.key_id_base64 ?? null,
            username: data.username ?? null,
          }
        : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lookup failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
