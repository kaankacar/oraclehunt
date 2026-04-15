import { NextRequest, NextResponse } from 'next/server'
import { fundWalletFromTreasury, getServerFaucetConfig } from '@/lib/server-faucet'

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
    const txHash = await fundWalletFromTreasury(body.walletAddress)
    const { usdcContract } = await getServerFaucetConfig()

    return NextResponse.json({
      amount: '2.00',
      asset: usdcContract,
      txHash,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Faucet failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
