import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/server-supabase'

export const runtime = 'nodejs'

interface RegisterBody {
  email?: string
  stellarAddress?: string
  keyIdBase64?: string
}

export async function POST(request: NextRequest) {
  let body: RegisterBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  const stellarAddress = body.stellarAddress?.trim()
  const keyIdBase64 = body.keyIdBase64?.trim()

  if (!email || !stellarAddress || !keyIdBase64) {
    return NextResponse.json(
      { error: 'email, stellarAddress, and keyIdBase64 are required' },
      { status: 400 },
    )
  }

  try {
    const supabase = await createServerSupabaseClient()

    const { data: existingByEmail, error: emailError } = await supabase
      .from('wallets')
      .select('id, email, stellar_address, key_id_base64')
      .eq('email', email)
      .maybeSingle()

    if (emailError) {
      return NextResponse.json({ error: emailError.message }, { status: 500 })
    }

    if (existingByEmail && existingByEmail.stellar_address !== stellarAddress) {
      return NextResponse.json(
        { error: 'This email is already linked to a different wallet.' },
        { status: 409 },
      )
    }

    const { data: existingByAddress, error: addressError } = await supabase
      .from('wallets')
      .select('id, email, stellar_address, key_id_base64')
      .eq('stellar_address', stellarAddress)
      .maybeSingle()

    if (addressError) {
      return NextResponse.json({ error: addressError.message }, { status: 500 })
    }

    if (existingByAddress && existingByAddress.email !== email) {
      return NextResponse.json(
        { error: 'This wallet is already linked to a different email.' },
        { status: 409 },
      )
    }

    const { data: existingByKeyId, error: keyIdError } = await supabase
      .from('wallets')
      .select('id, email, stellar_address, key_id_base64')
      .eq('key_id_base64', keyIdBase64)
      .maybeSingle()

    if (keyIdError) {
      return NextResponse.json({ error: keyIdError.message }, { status: 500 })
    }

    if (
      existingByKeyId &&
      (existingByKeyId.email !== email || existingByKeyId.stellar_address !== stellarAddress)
    ) {
      return NextResponse.json(
        { error: 'This passkey is already linked to a different wallet.' },
        { status: 409 },
      )
    }

    const { error: upsertError } = await supabase
      .from('wallets')
      .upsert(
        {
          email,
          stellar_address: stellarAddress,
          key_id_base64: keyIdBase64,
        },
        { onConflict: 'email' },
      )

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      wallet: {
        email,
        stellarAddress,
        keyIdBase64,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
