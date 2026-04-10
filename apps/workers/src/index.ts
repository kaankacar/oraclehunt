import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { paymentMiddleware } from '@x402/hono'
import { buildPaymentRoutes, buildResourceServer } from './middleware/payment'
import { handleOracle } from './oracles/handler'
import { handleHiddenOracle } from './oracles/hidden'
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

// x402 payment middleware on all public Oracle routes
app.use('/oracle/:id', async (c, next) => {
  const oracleId = c.req.param('id') as OracleId
  if (!VALID_ORACLE_IDS.includes(oracleId)) {
    return c.json({ error: 'Unknown oracle' }, 404)
  }

  const routes = buildPaymentRoutes(c.env)
  const server = buildResourceServer(c.env)

  return paymentMiddleware(routes, server)(c, next)
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

  const result = await handleOracle(oracleId, body, c.env, txHash)
  return c.json(result)
})

// Hidden Oracle — passphrase-gated, no x402 payment
app.post('/oracle/hidden', async (c) => {
  let body: { walletAddress: string; passphrase: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  if (!body.walletAddress?.trim() || !body.passphrase?.trim()) {
    return c.json({ error: 'walletAddress and passphrase are required' }, 400)
  }

  try {
    const result = await handleHiddenOracle(body.walletAddress, body.passphrase, c.env)
    return c.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_PASSPHRASE') {
      return c.json({ error: 'The Oracle does not recognize your phrase.' }, 403)
    }
    console.error('Hidden Oracle error:', err)
    return c.json({ error: 'The Oracle is silent.' }, 500)
  }
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

export default app
