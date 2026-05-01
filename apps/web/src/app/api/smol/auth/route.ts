import { Buffer } from 'node:buffer'
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/server-supabase'
import { getSmolApiBase, getSmolNetwork } from '@/lib/server-smol-config'

export const runtime = 'nodejs'

interface SmolAuthBody {
  contractId?: string
  keyIdBase64?: string
  assertion?: unknown
}

function getJwtExpiry(token: string): string {
  const [, payload] = token.split('.')
  if (!payload) throw new Error('Smol returned an invalid JWT.')

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number }
  if (!decoded.exp) throw new Error('Smol JWT did not include an expiration.')

  return new Date(decoded.exp * 1000).toISOString()
}

export async function POST(request: NextRequest) {
  let body: SmolAuthBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const contractId = body.contractId?.trim()
  const keyIdBase64 = body.keyIdBase64?.trim()
  if (!contractId || !keyIdBase64 || !body.assertion) {
    return NextResponse.json(
      { error: 'contractId, keyIdBase64, and assertion are required' },
      { status: 400 },
    )
  }

  try {
    const supabase = await createServerSupabaseClient()
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, stellar_address, key_id_base64')
      .eq('stellar_address', contractId)
      .maybeSingle()

    if (walletError) {
      return NextResponse.json({ error: walletError.message }, { status: 500 })
    }
    if (!wallet) {
      return NextResponse.json({ error: 'Wallet registration missing for this address.' }, { status: 404 })
    }
    if (wallet.key_id_base64 && wallet.key_id_base64 !== keyIdBase64) {
      return NextResponse.json({ error: 'This wallet is linked to a different passkey.' }, { status: 409 })
    }

    const smolBase = await getSmolApiBase()
    const loginUrl = `${smolBase}/login`
    const smolResponse = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: request.nextUrl.origin,
      },
      body: JSON.stringify({
        type: 'connect',
        keyId: keyIdBase64,
        contractId,
        response: body.assertion,
        network: getSmolNetwork(),
        protocol: 'passkey-kit',
      }),
    })

    const token = (await smolResponse.text()).trim()
    if (!smolResponse.ok) {
      return NextResponse.json(
        { error: token || `Smol auth failed with HTTP ${smolResponse.status}` },
        { status: smolResponse.status },
      )
    }

    const expiresAt = getJwtExpiry(token)
    const { error: updateError } = await supabase
      .from('wallets')
      .update({
        smol_jwt: token,
        smol_jwt_expires_at: expiresAt,
      })
      .eq('stellar_address', contractId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, expiresAt })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Smol authentication failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
