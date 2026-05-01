import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock x402 modules
vi.mock('@x402/hono', () => ({
  paymentMiddleware: vi.fn((_routes, _config) => {
    return async (c: any, next: any) => {
      const paymentHeader = c.req.header('PAYMENT-SIGNATURE')

      if (!paymentHeader) {
        c.res = new Response(
          JSON.stringify({ error: 'Payment required', x402Version: 1 }),
          {
            status: 402,
            headers: {
              'Content-Type': 'application/json',
              'PAYMENT-REQUIRED': 'eyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJzdGVsbGFyOnB1Ym5ldCJ9',
            },
          },
        )
        return
      }

      // Simulate signature validation
      if (paymentHeader === 'INVALID') {
        c.res = new Response(JSON.stringify({ error: 'Invalid payment' }), { status: 402 })
        return
      }

      if (paymentHeader === 'INSUFFICIENT') {
        c.res = new Response(JSON.stringify({ error: 'Insufficient payment amount' }), { status: 402 })
        return
      }

      if (paymentHeader === 'EXPIRED') {
        c.res = new Response(JSON.stringify({ error: 'Payment expired' }), { status: 402 })
        return
      }

      await next()
    }
  }),
}))

vi.mock('@x402/core/server', () => ({
  facilitatorConfig: vi.fn(() => ({})),
  x402ResourceServer: vi.fn().mockImplementation(() => ({
    register: vi.fn().mockReturnValue({}),
  })),
}))

vi.mock('@x402/stellar/exact/server', () => ({
  ExactStellarScheme: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('../oracles/handler', () => ({
  handleOracle: vi.fn().mockResolvedValue({
    artifact: 'Test prophecy',
    oracleId: 'seer',
    processingTrace: [],
    timestamp: '2026-01-01T00:00:00.000Z',
  }),
}))

vi.mock('../oracles/hidden', () => ({
  createHiddenOracleChallenge: vi.fn().mockResolvedValue({
    challengeId: 'challenge-1',
    nonce: '1',
    saltField: '2',
    expectedFingerprint: 'abc123def456',
    deriveTxHash: 'derive-tx',
    deriveExplorerUrl: 'https://stellar.expert/explorer/testnet/tx/derive-tx',
    fingerprintContractExplorerUrl: 'https://stellar.expert/explorer/testnet/contract/fingerprint',
  }),
  handleHiddenOracle: vi.fn().mockResolvedValue({
    fingerprint: 'abc123def456',
    zkPortrait: 'A portrait of cosmic identity',
    processingTrace: [],
    timestamp: '2026-01-01T00:00:00.000Z',
  }),
}))

const mockEnv = {
  GEMINI_API_KEY: 'test-key',
  ORACLE_TREASURY_ADDRESS: 'GBTEST123',
  ORACLE_TREASURY_SECRET: 'SBTESTSECRET',
  USDC_CONTRACT: 'CUSDC123',
  FINGERPRINT_SALT: 'test-salt',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-service-key',
  ZK_CONTRACT_ID: 'PLACEHOLDER',
  HIDDEN_ORACLE_VERIFIER_CONTRACT_ID: 'PLACEHOLDER',
  INFORMANT_PASSPHRASE: 'LIQUIDITY',
  STELLAR_NETWORK: 'pubnet',
  ORACLE_WALLET_SEER: 'GSEER',
  ORACLE_WALLET_PAINTER: 'GPAINTER',
  ORACLE_WALLET_COMPOSER: 'GCOMPOSER',
  ORACLE_WALLET_SCRIBE: 'GSCRIBE',
  ORACLE_WALLET_SCHOLAR: 'GSCHOLAR',
  ORACLE_WALLET_INFORMANT: 'GINFORMANT',
}

function buildApp() {
  // Re-import to get fresh mocked version
  const { default: app } = require('../index')
  return app
}

describe('x402 payment middleware', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns 402 with PAYMENT-REQUIRED header on unpaid request', async () => {
    const { default: app } = await import('../index')
    const req = new Request('http://localhost/oracle/seer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Tell my fortune', walletAddress: 'GTEST' }),
    })

    const res = await app.fetch(req, mockEnv)
    expect(res.status).toBe(402)
    expect(res.headers.get('PAYMENT-REQUIRED')).not.toBeNull()
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBeNull()
    await expect(res.json()).resolves.toHaveProperty('error', 'Payment required')
  })

  it('builds payment routes with each oracle wallet as payTo', async () => {
    const { buildPaymentRoutes } = await import('./payment')
    const routes = buildPaymentRoutes(mockEnv)

    expect((routes as any)['POST /oracle/seer'].accepts.payTo).toBe('GSEER')
    expect((routes as any)['POST /oracle/painter'].accepts.payTo).toBe('GPAINTER')
    expect((routes as any)['POST /oracle/composer'].accepts.payTo).toBe('GCOMPOSER')
    expect((routes as any)['POST /oracle/scribe'].accepts.payTo).toBe('GSCRIBE')
    expect((routes as any)['POST /oracle/scholar'].accepts.payTo).toBe('GSCHOLAR')
    expect((routes as any)['POST /oracle/informant'].accepts.payTo).toBe('GINFORMANT')
  })

  it('returns 200 with artifact on valid payment', async () => {
    const { default: app } = await import('../index')
    const req = new Request('http://localhost/oracle/seer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-SIGNATURE': 'VALID_PAYMENT_SIGNATURE',
      },
      body: JSON.stringify({ prompt: 'Tell my fortune', walletAddress: 'GTEST' }),
    })

    const res = await app.fetch(req, mockEnv)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('artifact')
    expect(body).toHaveProperty('oracleId', 'seer')
  })

  it('returns 402 on invalid payment signature', async () => {
    const { default: app } = await import('../index')
    const req = new Request('http://localhost/oracle/seer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-SIGNATURE': 'INVALID',
      },
      body: JSON.stringify({ prompt: 'Tell my fortune', walletAddress: 'GTEST' }),
    })

    const res = await app.fetch(req, mockEnv)
    expect(res.status).toBe(402)
  })

  it('returns 402 on insufficient payment amount', async () => {
    const { default: app } = await import('../index')
    const req = new Request('http://localhost/oracle/seer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-SIGNATURE': 'INSUFFICIENT',
      },
      body: JSON.stringify({ prompt: 'Tell my fortune', walletAddress: 'GTEST' }),
    })

    const res = await app.fetch(req, mockEnv)
    expect(res.status).toBe(402)
  })

  it('returns 402 on expired payment', async () => {
    const { default: app } = await import('../index')
    const req = new Request('http://localhost/oracle/seer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-SIGNATURE': 'EXPIRED',
      },
      body: JSON.stringify({ prompt: 'Tell my fortune', walletAddress: 'GTEST' }),
    })

    const res = await app.fetch(req, mockEnv)
    expect(res.status).toBe(402)
  })

  it('returns 404 for unknown oracle', async () => {
    const { default: app } = await import('../index')
    const req = new Request('http://localhost/oracle/unknown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'PAYMENT-SIGNATURE': 'VALID' },
      body: JSON.stringify({ prompt: 'test', walletAddress: 'GTEST' }),
    })

    const res = await app.fetch(req, mockEnv)
    expect(res.status).toBe(404)
  })

  it('returns 200 on Hidden Oracle challenge creation', async () => {
    const { default: app } = await import('../index')
    const req = new Request('http://localhost/oracle/hidden/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: 'GTEST' }),
    })

    const res = await app.fetch(req, mockEnv)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('challengeId')
    expect(body).toHaveProperty('expectedFingerprint')
  })

  it('returns 403 on wrong Hidden Oracle passphrase proof', async () => {
    const { default: app } = await import('../index')
    // Mock handleHiddenOracle to throw INVALID_PASSPHRASE
    const { handleHiddenOracle } = await import('../oracles/hidden')
    vi.mocked(handleHiddenOracle).mockRejectedValueOnce(new Error('INVALID_PASSPHRASE'))

    const req = new Request('http://localhost/oracle/hidden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: 'GTEST',
        challengeId: 'challenge-1',
        proof: { pi_a: ['1', '2', '1'], pi_b: [['1', '2'], ['3', '4'], ['1', '0']], pi_c: ['1', '2', '1'] },
        publicSignals: ['1', '2', '3', '4'],
      }),
    })

    const res = await app.fetch(req, mockEnv)
    expect(res.status).toBe(403)
  })

  it('returns 200 on valid Hidden Oracle proof submission', async () => {
    const { default: app } = await import('../index')
    const req = new Request('http://localhost/oracle/hidden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: 'GTEST',
        challengeId: 'challenge-1',
        proof: { pi_a: ['1', '2', '1'], pi_b: [['1', '2'], ['3', '4'], ['1', '0']], pi_c: ['1', '2', '1'] },
        publicSignals: ['1', '2', '3', '4'],
      }),
    })

    const res = await app.fetch(req, mockEnv)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('fingerprint')
    expect(body).toHaveProperty('zkPortrait')
  })
})
