import { x402ResourceServer } from '@x402/core/server'
import { ExactStellarScheme as ServerExactStellarScheme } from '@x402/stellar/exact/server'
import { convertToTokenAmount } from '@x402/stellar'
import {
  Transaction,
  TransactionBuilder,
  Account,
  Keypair,
  Operation,
  xdr,
  Address,
  scValToNative,
} from '@stellar/stellar-sdk'
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

export const ORACLE_PRICE_USDC: Record<OracleId, number> = {
  seer: 0.10,
  painter: 0.10,
  composer: 0.15,
  scribe: 0.05,
  scholar: 0.10,
  informant: 0.15,
}

function toAssetAmount(price: string, asset: string) {
  return {
    amount: convertToTokenAmount(price.replace(/^\$/, ''), 7),
    asset,
    extra: {},
  }
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
        payTo: getOracleWalletAddress(env, oracleId),
        price: toAssetAmount(price, env.USDC_CONTRACT),
        maxTimeoutSeconds: 60,
        extra: { areFeesSponsored: true },
      },
      description: `Oracle Hunt — consult The ${oracleId.charAt(0).toUpperCase() + oracleId.slice(1)}`,
      mimeType: 'application/json',
    }
  }

  return routes
}

export function getOracleWalletAddress(env: Env, oracleId: OracleId): string {
  const wallets: Record<OracleId, string | undefined> = {
    seer: env.ORACLE_WALLET_SEER,
    painter: env.ORACLE_WALLET_PAINTER,
    composer: env.ORACLE_WALLET_COMPOSER,
    scribe: env.ORACLE_WALLET_SCRIBE,
    scholar: env.ORACLE_WALLET_SCHOLAR,
    informant: env.ORACLE_WALLET_INFORMANT,
  }

  return wallets[oracleId] ?? env.ORACLE_TREASURY_ADDRESS
}

/**
 * Self-hosted x402 facilitator using pure XDR parsing + native fetch.
 *
 * Why not x402.org:
 *   Passkey wallet __check_auth (secp256r1 WebAuthn) costs ~56 000 stroops on-chain.
 *   x402.org caps fees at 50 000 stroops → "fee_exceeds_maximum" on every request.
 *
 * Why not FacilitatorExactStellarScheme directly:
 *   Its verify() and settle() use stellar-sdk's rpc.Server which uses Axios.
 *   Axios fails in Cloudflare Workers (nodejs_compat doesn't expose working http adapter).
 *
 * This implementation avoids Axios entirely:
 *   • verify() — pure XDR parsing, no HTTP
 *   • settle() — native fetch for Horizon + Stellar RPC calls
 */
class LocalFacilitator {
  private readonly treasuryAddress: string
  private readonly treasurySecret: string
  private readonly network: 'stellar:pubnet' | 'stellar:testnet'
  // Passkey-backed smart-account auth can push Soroban resource fees far above
  // the original 200k cap. Recent live browser-signed requests have come in at
  // ~23.4M stroops on testnet, so keep a bounded ceiling with headroom.
  private readonly maxTransactionFeeStroops = 50_000_000

  constructor(treasuryAddress: string, treasurySecret: string, network: 'stellar:pubnet' | 'stellar:testnet') {
    this.treasuryAddress = treasuryAddress
    this.treasurySecret = treasurySecret
    this.network = network
  }

  private get rpcUrl(): string {
    return this.network === 'stellar:testnet'
      ? 'https://soroban-testnet.stellar.org'
      : 'https://soroban-mainnet.stellar.org'
  }

  private get horizonUrl(): string {
    return this.network === 'stellar:testnet'
      ? 'https://horizon-testnet.stellar.org'
      : 'https://horizon.stellar.org'
  }

  private get networkPassphrase(): string {
    return this.network === 'stellar:testnet'
      ? 'Test SDF Network ; September 2015'
      : 'Public Global Stellar Network ; September 2015'
  }

  async getSupported() {
    return {
      kinds: [{ x402Version: 2, scheme: 'exact', network: this.network, extra: { areFeesSponsored: true } }],
      extensions: [] as string[],
      signers: {} as Record<string, string[]>,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async verify(paymentPayload: any, requirements: any) {
    const fail = (invalidReason: string, payer?: string, extra?: Record<string, unknown>) => {
      console.error('[x402 verify] FAILED:', invalidReason, payer ? `payer:${payer}` : '', extra ?? '')
      return payer
        ? { isValid: false, invalidReason, payer }
        : { isValid: false, invalidReason }
    }

    try {
      const stellarPayload = paymentPayload.payload
      if (!stellarPayload?.transaction || typeof stellarPayload.transaction !== 'string') {
        return fail('invalid_exact_stellar_payload_malformed')
      }

      let transaction: Transaction
      try {
        transaction = new Transaction(stellarPayload.transaction, this.networkPassphrase)
      } catch {
        return fail('invalid_exact_stellar_payload_malformed')
      }

      if (transaction.operations.length !== 1) {
        return fail('invalid_exact_stellar_payload_wrong_operation')
      }

      const op = transaction.operations[0]
      if (!op) {
        return fail('invalid_exact_stellar_payload_wrong_operation')
      }
      if (op.type !== 'invokeHostFunction') {
        return fail('invalid_exact_stellar_payload_wrong_operation')
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invokeOp = op as any
      const func = invokeOp.func
      if (!func || func.switch().name !== 'hostFunctionTypeInvokeContract') {
        return fail('invalid_exact_stellar_payload_wrong_operation')
      }

      const invokeArgs = func.invokeContract()
      const contractAddress = Address.fromScAddress(invokeArgs.contractAddress()).toString()
      if (contractAddress !== requirements.asset) {
        return fail('invalid_exact_stellar_payload_wrong_asset')
      }

      const functionName = invokeArgs.functionName().toString()
      const args = invokeArgs.args()
      if (functionName !== 'transfer' || args.length !== 3) {
        return fail('invalid_exact_stellar_payload_wrong_function_name')
      }

      const fromAddress = scValToNative(args[0]) as string
      const toAddress = scValToNative(args[1]) as string
      const amount = scValToNative(args[2]) as bigint

      if (toAddress !== requirements.payTo) {
        return fail('invalid_exact_stellar_payload_wrong_recipient', fromAddress)
      }
      if (amount !== BigInt(requirements.amount)) {
        return fail('invalid_exact_stellar_payload_wrong_amount', fromAddress)
      }

      const clientFee = parseInt(transaction.fee, 10)
      if (clientFee > this.maxTransactionFeeStroops) {
        return fail('invalid_exact_stellar_payload_fee_exceeds_maximum', fromAddress, {
          clientFee,
          maxTransactionFeeStroops: this.maxTransactionFeeStroops,
        })
      }

      // Verify all auth entries are signed (no scvVoid — would mean unsigned)
      for (const auth of (invokeOp.auth ?? [])) {
        const credTypeName = auth.credentials().switch().name
        if (credTypeName === 'sorobanCredentialsAddress') {
          const sig = auth.credentials().address().signature()
          if (sig.switch().name === 'scvVoid') {
            return fail('invalid_exact_stellar_payload_missing_payer_signature', fromAddress)
          }
        }
      }

      console.log('[x402 verify] PASSED, payer:', fromAddress, 'fee:', clientFee)
      return { isValid: true, payer: fromAddress }
    } catch (e) {
      console.error('[x402 verify] unexpected error:', e instanceof Error ? e.message : String(e))
      return { isValid: false, invalidReason: 'unexpected_verify_error' }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async settle(paymentPayload: any, requirements: any) {
    const stellarPayload = paymentPayload.payload
    const passphrase = this.networkPassphrase

    try {
      // 1. Get treasury account sequence from Horizon (native fetch, not Axios)
      const accRes = await fetch(`${this.horizonUrl}/accounts/${this.treasuryAddress}`)
      if (!accRes.ok) {
        console.error('[x402 settle] Horizon account lookup failed:', accRes.status)
        return { success: false, errorReason: 'settle_treasury_account_not_found', network: requirements.network, transaction: '' }
      }
      const accData = await accRes.json() as { sequence: string }
      const treasuryAccount = new Account(this.treasuryAddress, accData.sequence)

      // 2. Extract sorobanData from the signed client transaction
      const txEnvelope = xdr.TransactionEnvelope.fromXDR(stellarPayload.transaction, 'base64')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sorobanData = (txEnvelope.v1() as any)?.tx()?.ext()?.sorobanData?.()
      if (!sorobanData) {
        return { success: false, errorReason: 'invalid_exact_stellar_payload_malformed', network: requirements.network, transaction: '' }
      }
      const sorobanDataXdr: string = sorobanData.toXDR('base64')

      // 3. Parse the client's signed transaction to get the InvokeHostFunction operation
      //    (including the passkey-signed auth entries)
      const clientTx = new Transaction(stellarPayload.transaction, passphrase)
      const invokeOp = clientTx.operations[0]
      const clientFee = parseInt(clientTx.fee, 10)
      const maxFee = Math.min(clientFee, this.maxTransactionFeeStroops)

      // 4. Rebuild the transaction from the treasury account.
      //    Source = oracle treasury (pays XLM fees).
      //    Auth entries from the original op are preserved → passkey signature still valid
      //    (Soroban auth signatures cover the rootInvocation, not the transaction hash).
      const rebuiltTx = new TransactionBuilder(treasuryAccount, {
        fee: maxFee.toString(),
        networkPassphrase: passphrase,
        sorobanData: sorobanDataXdr,
      } as ConstructorParameters<typeof TransactionBuilder>[1])
        .setTimeout(requirements.maxTimeoutSeconds ?? 60)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .addOperation(Operation.invokeHostFunction(invokeOp as any))
        .build()

      // 5. Sign with oracle treasury key
      const keypair = Keypair.fromSecret(this.treasurySecret)
      rebuiltTx.sign(keypair)
      const signedXdr = rebuiltTx.toEnvelope().toXDR('base64')

      // 6. Submit via Horizon. In local workerd, RPC POSTs for large passkey-auth
      // payloads have been intermittently throwing internal errors. Horizon accepts
      // v1 transaction envelopes synchronously, which avoids the extra poll loop.
      const sendRes = await fetch(`${this.horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(signedXdr)}`,
      })
      const sendJson = await sendRes.json() as {
        hash?: string
        successful?: boolean
        extras?: { result_codes?: unknown }
        title?: string
        detail?: string
      }

      if (!sendRes.ok || sendJson.successful === false || !sendJson.hash) {
        console.error('[x402 settle] Horizon submission failed:', JSON.stringify(sendJson))
        return {
          success: false,
          errorReason: 'settle_exact_stellar_transaction_submission_failed',
          network: requirements.network,
          transaction: sendJson.hash ?? '',
        }
      }

      console.log('[x402 settle] CONFIRMED via Horizon, tx:', sendJson.hash)
      return { success: true, transaction: sendJson.hash, network: requirements.network, payer: '' }
    } catch (e) {
      console.error('[x402 settle] unexpected error:', e instanceof Error ? e.message : String(e))
      return { success: false, errorReason: 'unexpected_settle_error', network: requirements.network, transaction: '' }
    }
  }
}

export function buildResourceServer(env: Env): x402ResourceServer {
  const network = stellarNetwork(env)
  if (!env.ORACLE_TREASURY_SECRET) {
    throw new Error('Missing ORACLE_TREASURY_SECRET')
  }

  const localFacilitator = new LocalFacilitator(env.ORACLE_TREASURY_ADDRESS, env.ORACLE_TREASURY_SECRET, network)

  return (new x402ResourceServer(localFacilitator as never)).register(
    network,
    new ServerExactStellarScheme(),
  )
}
