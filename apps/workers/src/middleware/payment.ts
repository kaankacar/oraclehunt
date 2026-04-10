import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server'
import { ExactStellarScheme } from '@x402/stellar/exact/server'
import type { RoutesConfig } from '@x402/core/server'
import type { OracleId, Env } from '../types'

// Price per Oracle (string format understood by ExactStellarScheme, e.g. "$0.10")
const ORACLE_PRICES: Record<OracleId, string> = {
  seer: '$0.10',
  painter: '$0.10',
  composer: '$0.15',
  scribe: '$0.05',
  scholar: '$0.10',
  informant: '$0.15',
}

export type { RoutesConfig }

function stellarNetwork(env: Env): 'stellar:pubnet' | 'stellar:testnet' {
  return env.STELLAR_NETWORK === 'pubnet' ? 'stellar:pubnet' : 'stellar:testnet'
}

export function buildPaymentRoutes(env: Env): RoutesConfig {
  const routes: RoutesConfig = {}
  const network = stellarNetwork(env)

  for (const [oracleId, price] of Object.entries(ORACLE_PRICES) as [OracleId, string][]) {
    const key = `POST /oracle/${oracleId}`
    ;(routes as Record<string, unknown>)[key] = {
      accepts: {
        scheme: 'exact',
        network,
        payTo: env.ORACLE_TREASURY_ADDRESS,
        price,
        maxTimeoutSeconds: 60,
        extra: { areFeesSponsored: true },
      },
      description: `Oracle Hunt — consult The ${oracleId.charAt(0).toUpperCase() + oracleId.slice(1)}`,
      mimeType: 'application/json',
    }
  }

  return routes
}

export function buildResourceServer(env: Env): x402ResourceServer {
  const facilitator = new HTTPFacilitatorClient({
    url: 'https://x402.org/facilitator',
  })

  return new x402ResourceServer(facilitator).register(
    stellarNetwork(env),
    new ExactStellarScheme(),
  )
}
