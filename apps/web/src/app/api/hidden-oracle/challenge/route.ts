import { NextRequest, NextResponse } from 'next/server'
import { createHiddenOracleChallenge } from '@/lib/hidden-oracle-service'
import { getHiddenOracleEnv } from '@/lib/server-hidden-oracle-env'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  let body: { walletAddress?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.walletAddress?.trim()) {
    return NextResponse.json({ error: 'walletAddress is required' }, { status: 400 })
  }

  try {
    const env = await getHiddenOracleEnv()
    const result = await createHiddenOracleChallenge(body.walletAddress, env)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Hidden Oracle challenge failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
