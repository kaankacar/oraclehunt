import { NextRequest, NextResponse } from 'next/server'
import { handleHiddenOracle } from '@/lib/hidden-oracle-service'
import { getHiddenOracleEnv } from '@/lib/server-hidden-oracle-env'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  let body: {
    walletAddress?: string
    challengeId?: string
    proof?: unknown
    publicSignals?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (
    !body.walletAddress?.trim()
    || !body.challengeId?.trim()
    || !body.proof
    || !Array.isArray(body.publicSignals)
  ) {
    return NextResponse.json(
      { error: 'walletAddress, challengeId, proof, and publicSignals are required' },
      { status: 400 },
    )
  }

  try {
    const env = await getHiddenOracleEnv()
    const result = await handleHiddenOracle(
      body.walletAddress,
      body.challengeId,
      body.proof as never,
      body.publicSignals as string[],
      env,
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_PASSPHRASE') {
      return NextResponse.json({ error: 'The Oracle does not recognize your phrase.' }, { status: 403 })
    }

    const message = error instanceof Error ? error.message : 'The Oracle is silent.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
