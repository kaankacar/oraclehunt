import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/server-supabase'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  let body: { email?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  try {
    const supabase = await createServerSupabaseClient()
    const { data, error } = await supabase
      .from('wallets')
      .select('stellar_address, key_id_base64')
      .eq('email', email)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      wallet: data
        ? {
            stellarAddress: data.stellar_address,
            keyIdBase64: data.key_id_base64 ?? null,
          }
        : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lookup failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
