import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
// @x402/hono uses Buffer for base64-encoding the payment response header.
// Cloudflare Workers doesn't expose Buffer as a global even with nodejs_compat,
// so we set it explicitly here before any x402 code runs.
globalThis.Buffer = Buffer

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { paymentMiddleware } from '@x402/hono'
import { buildPaymentRoutes, buildResourceServer } from './middleware/payment'
import {
  handleComposerOracle,
  pollComposerStatus,
  reconcileComposerSettlement,
  resumeComposerOracle,
} from './oracles/composer'
import { attachOracleSettlement, applyPaymentSettlementToTrace, handleOracle } from './oracles/handler'
import { createHiddenOracleChallenge, handleHiddenOracle } from './oracles/hidden'
import { fundTestnetWallet } from './faucet'
import { getTxExplorerUrl } from './stellar'
import type { Env, OracleId, OracleRequest } from './types'

const VALID_ORACLE_IDS: OracleId[] = ['seer', 'painter', 'composer', 'scribe', 'scholar', 'informant']
const VALID_PERSONALITIES = new Set(['default', 'sassy', 'slam_poet', 'crypto_degen'])

const app = new Hono<{ Bindings: Env }>()

function extractPaymentTransactionHash(encodedHeader: string | null): string | undefined {
  if (!encodedHeader) return undefined

  const decode = (encoding: BufferEncoding) => {
    const parsed = JSON.parse(Buffer.from(encodedHeader, encoding).toString('utf8')) as {
      transaction?: string
      txHash?: string
    }
    return parsed.transaction ?? parsed.txHash
  }

  try {
    return decode('base64url')
  } catch {
    try {
      return decode('base64')
    } catch {
      return encodedHeader
    }
  }
}

function createComposerPaymentReference(rawPaymentHeader: string | null, settledTxHash?: string): string | undefined {
  if (settledTxHash) return settledTxHash
  if (!rawPaymentHeader) return undefined

  const digest = createHash('sha256').update(rawPaymentHeader).digest('hex')
  return `payref:${digest}`
}

function isConfirmedStellarTxHash(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{64}$/i.test(value))
}

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

app.use('/oracle/:id', async (c, next) => {
  if (
    c.req.method !== 'POST'
    || c.req.path === '/oracle/composer/resume'
    || c.req.path.startsWith('/oracle/composer/status/')
  ) {
    return next()
  }

  const oracleId = c.req.param('id')
  await next()

  if (c.res.status >= 400 || oracleId === 'hidden') {
    return
  }

  const settledTxHash = extractPaymentTransactionHash(
    c.res.headers.get('PAYMENT-RESPONSE') ?? c.res.headers.get('X-PAYMENT-RESPONSE'),
  )
  if (!isConfirmedStellarTxHash(settledTxHash)) {
    return
  }

  const contentType = c.res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return
  }

  const payload = await c.res.clone().json().catch(() => null) as Record<string, unknown> | null
  if (!payload) {
    return
  }

  if (oracleId === 'composer') {
    const provisionalPaymentRef = typeof payload.txHash === 'string' ? payload.txHash : undefined
    await reconcileComposerSettlement(c.env, provisionalPaymentRef, settledTxHash)

    payload.txHash = settledTxHash
    payload.explorerUrl = getTxExplorerUrl(c.env, settledTxHash)
    if (Array.isArray(payload.processingTrace)) {
      payload.processingTrace = applyPaymentSettlementToTrace(
        c.env,
        payload.processingTrace as never,
        settledTxHash,
        'The x402 USDC payment settled before Composer generation was queued.',
      )
    }
  } else {
    const consultationId = c.res.headers.get('X-Oracle-Consultation-Id')
    if (!consultationId) {
      return
    }

    const settlement = await attachOracleSettlement(consultationId, settledTxHash, c.env)
    payload.txHash = settledTxHash
    payload.explorerUrl = settlement.explorerUrl
    payload.processingTrace = settlement.processingTrace
  }

  const headers = new Headers(c.res.headers)
  headers.delete('content-length')
  headers.delete('X-Oracle-Consultation-Id')
  c.res = new Response(JSON.stringify(payload), {
    status: c.res.status,
    headers,
  })
})

// x402 payment middleware on all public Oracle routes
app.use('/oracle/:id', async (c, next) => {
  if (
    c.req.path === '/oracle/composer/resume'
    || c.req.path.startsWith('/oracle/composer/status/')
  ) {
    return next()
  }

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

app.post('/oracle/composer/resume', async (c) => {
  let body: { walletAddress?: string; txHash?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  if (!body.walletAddress?.trim() || !body.txHash?.trim()) {
    return c.json({ error: 'walletAddress and txHash are required' }, 400)
  }

  try {
    const result = await resumeComposerOracle(body.walletAddress, body.txHash, c.env)
    const status = 'status' in result && result.status !== 'error' ? 202 : 200
    return c.json(result, status)
  } catch (err) {
    console.error('Composer resume error:', err)
    const message = err instanceof Error ? err.message : 'Composer resume failed.'
    return c.json({ error: message }, 500)
  }
})

app.get('/oracle/composer/status/:jobId', async (c) => {
  const jobId = c.req.param('jobId')
  if (!jobId?.trim()) {
    return c.json({ error: 'jobId is required' }, 400)
  }

  try {
    const result = await pollComposerStatus(jobId, c.env)
    const status = 'status' in result && result.status === 'pending' ? 202 : 200
    return c.json(result, status)
  } catch (err) {
    console.error('Composer status error:', err)
    const message = err instanceof Error ? err.message : 'Composer status failed.'
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

  if (body.personality && !VALID_PERSONALITIES.has(body.personality)) {
    return c.json({ error: 'Invalid personality' }, 400)
  }

  const composerPaymentRef = createComposerPaymentReference(
    c.req.header('PAYMENT-SIGNATURE') ?? c.req.header('X-PAYMENT') ?? null,
  )

  try {
    if (oracleId === 'composer') {
      const result = await handleComposerOracle(body, c.env, composerPaymentRef)
      const status = 'status' in result && result.status !== 'error' ? 202 : 200
      return c.json(result, status)
    }

    const result = await handleOracle(oracleId, body, c.env)
    const { consultationId, ...publicResult } = result
    c.header('X-Oracle-Consultation-Id', consultationId)
    return c.json(publicResult)
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

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>) {
    for (const message of batch.messages) {
      message.ack()
    }
  },
}
