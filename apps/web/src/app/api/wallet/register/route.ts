import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/server-supabase'

export const runtime = 'nodejs'

interface RegisterBody {
  username?: string
  stellarAddress?: string
  keyIdBase64?: string
}

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

function isValidUsername(username: string): boolean {
  return /^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])?$/.test(username)
}

export async function POST(request: NextRequest) {
  let body: RegisterBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const rawUsername = body.username?.trim()
  const stellarAddress = body.stellarAddress?.trim()
  const keyIdBase64 = body.keyIdBase64?.trim()
  const username = rawUsername ? normalizeUsername(rawUsername) : ''

  if (!username || !stellarAddress || !keyIdBase64) {
    return NextResponse.json(
      { error: 'username, stellarAddress, and keyIdBase64 are required' },
      { status: 400 },
    )
  }

  if (!isValidUsername(username)) {
    return NextResponse.json(
      {
        error:
          'Username must be 3-24 characters and use only lowercase letters, numbers, hyphens, or underscores.',
      },
      { status: 400 },
    )
  }

  try {
    const supabase = await createServerSupabaseClient()

    const { data: existingByUsername, error: usernameError } = await supabase
      .from('wallets')
      .select('id, username, stellar_address, key_id_base64')
      .eq('username', username)
      .maybeSingle()

    if (usernameError) {
      return NextResponse.json({ error: usernameError.message }, { status: 500 })
    }

    if (existingByUsername && existingByUsername.stellar_address !== stellarAddress) {
      return NextResponse.json(
        { error: 'That username is already taken.' },
        { status: 409 },
      )
    }

    const { data: existingByAddress, error: addressError } = await supabase
      .from('wallets')
      .select('id, username, stellar_address, key_id_base64')
      .eq('stellar_address', stellarAddress)
      .maybeSingle()

    if (addressError) {
      return NextResponse.json({ error: addressError.message }, { status: 500 })
    }

    if (
      existingByAddress &&
      existingByAddress.key_id_base64 &&
      existingByAddress.key_id_base64 !== keyIdBase64
    ) {
      return NextResponse.json(
        { error: 'This wallet is already linked to a different passkey.' },
        { status: 409 },
      )
    }

    const { data: existingByKeyId, error: keyIdError } = await supabase
      .from('wallets')
      .select('id, username, stellar_address, key_id_base64')
      .eq('key_id_base64', keyIdBase64)
      .maybeSingle()

    if (keyIdError) {
      return NextResponse.json({ error: keyIdError.message }, { status: 500 })
    }

    if (
      existingByKeyId &&
      existingByKeyId.stellar_address !== stellarAddress
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
          username,
          stellar_address: stellarAddress,
          key_id_base64: keyIdBase64,
        },
        { onConflict: 'stellar_address' },
      )

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      wallet: {
        username,
        stellarAddress,
        keyIdBase64,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
