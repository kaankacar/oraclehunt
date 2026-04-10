import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { ORACLE_PROMPTS } from './prompts'
import type { OracleId, Env, OracleRequest, OracleResponse } from '../types'

export async function handleOracle(
  oracleId: OracleId,
  req: OracleRequest,
  env: Env,
  txHash?: string,
): Promise<OracleResponse> {
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: ORACLE_PROMPTS[oracleId],
    messages: [{ role: 'user', content: req.prompt }],
  })

  const artifact = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')

  const timestamp = new Date().toISOString()

  // Save to Supabase
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)

  const { data: wallet } = await supabase
    .from('wallets')
    .select('id')
    .eq('stellar_address', req.walletAddress)
    .single()

  if (wallet) {
    await supabase.from('consultations').insert({
      wallet_id: wallet.id,
      oracle_id: oracleId,
      prompt: req.prompt,
      artifact_text: artifact,
      tx_hash: txHash ?? null,
    })
  }

  return { artifact, oracleId, txHash, timestamp }
}
