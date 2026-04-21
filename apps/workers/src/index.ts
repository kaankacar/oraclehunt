import { Buffer } from 'node:buffer'
// @x402/hono uses Buffer for base64-encoding the payment response header.
// Cloudflare Workers doesn't expose Buffer as a global even with nodejs_compat,
// so we set it explicitly here before any x402 code runs.
globalThis.Buffer = Buffer

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { paymentMiddleware } from '@x402/hono'
import { buildPaymentRoutes, buildResourceServer } from './middleware/payment'
import { handleOracle } from './oracles/handler'
import { createHiddenOracleChallenge, handleHiddenOracle } from './oracles/hidden'
import { fundTestnetWallet } from './faucet'
import type { Env, OracleId, OracleRequest } from './types'

const VALID_ORACLE_IDS: OracleId[] = ['seer', 'painter', 'composer', 'scribe', 'scholar', 'informant']

const app = new Hono<{ Bindings: Env }>()

// CORS — expose x402 headers so the browser can read them
app.use('*', async (c, next) => {
  const origin = c.env.ADMIN_CORS_ORIGIN ?? '*'
  return cors({
    origin,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    exposeHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', 'X-PAYMENT-RESPONSE'],
  })(c, next)
})

app.onError((err, c) => {
  console.error('Unhandled worker error:', err)
  const origin = c.env.ADMIN_CORS_ORIGIN ?? '*'
  return c.json(
    { error: err instanceof Error ? err.message : 'Unhandled worker error' },
    500,
    {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED,PAYMENT-RESPONSE,X-PAYMENT-RESPONSE',
    },
  )
})

// x402 payment middleware on all public Oracle routes
app.use('/oracle/:id', async (c, next) => {
  const oracleId = c.req.param('id')
  if (oracleId === 'hidden') {
    return next()
  }
  if (!VALID_ORACLE_IDS.includes(oracleId as OracleId)) {
    return c.json({ error: 'Unknown oracle' }, 404)
  }

  const xPayment = c.req.header('X-PAYMENT') ?? c.req.header('PAYMENT-SIGNATURE')
  console.log('[x402 request]', oracleId, xPayment ? `payment-header-present:${xPayment.length}` : 'payment-header-missing')

  const routes = buildPaymentRoutes(c.env)
  const server = buildResourceServer(c.env)

  return paymentMiddleware(routes, server)(c, next)
})

// Oracle consultation endpoint
// Hidden Oracle — passphrase-gated, no x402 payment
app.post('/oracle/hidden/challenge', async (c) => {
  let body: { walletAddress: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  if (!body.walletAddress?.trim()) {
    return c.json({ error: 'walletAddress is required' }, 400)
  }

  try {
    const result = await createHiddenOracleChallenge(body.walletAddress, c.env)
    return c.json(result)
  } catch (err) {
    console.error('Hidden Oracle challenge error:', err)
    const message = err instanceof Error ? err.message : 'Hidden Oracle challenge failed'
    return c.json({ error: message }, 500)
  }
})

app.post('/oracle/hidden', async (c) => {
  let body: {
    walletAddress: string
    challengeId: string
    proof: unknown
    publicSignals: unknown
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  if (
    !body.walletAddress?.trim()
    || !body.challengeId?.trim()
    || !body.proof
    || !Array.isArray(body.publicSignals)
  ) {
    return c.json({ error: 'walletAddress, challengeId, proof, and publicSignals are required' }, 400)
  }

  try {
    const result = await handleHiddenOracle(
      body.walletAddress,
      body.challengeId,
      body.proof as never,
      body.publicSignals as string[],
      c.env,
    )
    return c.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_PASSPHRASE') {
      return c.json({ error: 'The Oracle does not recognize your phrase.' }, 403)
    }
    console.error('Hidden Oracle error:', err)
    const message = err instanceof Error ? err.message : 'The Oracle is silent.'
    return c.json({ error: message }, 500)
  }
})

// Oracle consultation endpoint
app.post('/oracle/:id', async (c) => {
  const oracleId = c.req.param('id') as OracleId
  if (!VALID_ORACLE_IDS.includes(oracleId)) {
    return c.json({ error: 'Unknown oracle' }, 404)
  }

  let body: OracleRequest
  try {
    body = await c.req.json<OracleRequest>()
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  if (!body.prompt?.trim() || !body.walletAddress?.trim()) {
    return c.json({ error: 'prompt and walletAddress are required' }, 400)
  }

  if (body.prompt.length > 1000) {
    return c.json({ error: 'Prompt too long (max 1000 characters)' }, 400)
  }

  const txHash = c.res.headers.get('X-PAYMENT-RESPONSE') ?? undefined

  try {
    const result = await handleOracle(oracleId, body, c.env, txHash)
    return c.json(result)
  } catch (err) {
    console.error('Oracle error:', err)
    const message = err instanceof Error ? err.message : 'The Oracle is silent.'
    return c.json({ error: message }, 500)
  }
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// Local/testnet faucet for passkey wallets.
app.post('/faucet', async (c) => {
  let body: { walletAddress: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  if (!body.walletAddress?.trim()) {
    return c.json({ error: 'walletAddress is required' }, 400)
  }

  try {
    const txHash = await fundTestnetWallet(body.walletAddress, c.env)
    return c.json({
      amount: '2.00',
      asset: c.env.USDC_CONTRACT,
      txHash,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Faucet failed'
    return c.json({ error: message }, 500)
  }
})

export default app
