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
        payTo: env.ORACLE_TREASURY_ADDRESS,
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
  private readonly maxTransactionFeeStroops = 200_000

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
    try {
      const stellarPayload = paymentPayload.payload
      if (!stellarPayload?.transaction || typeof stellarPayload.transaction !== 'string') {
        return { isValid: false, invalidReason: 'invalid_exact_stellar_payload_malformed' }
      }

      let transaction: Transaction
      try {
        transaction = new Transaction(stellarPayload.transaction, this.networkPassphrase)
      } catch {
        return { isValid: false, invalidReason: 'invalid_exact_stellar_payload_malformed' }
      }

      if (transaction.operations.length !== 1) {
        return { isValid: false, invalidReason: 'invalid_exact_stellar_payload_wrong_operation' }
      }

      const op = transaction.operations[0]
      if (op.type !== 'invokeHostFunction') {
        return { isValid: false, invalidReason: 'invalid_exact_stellar_payload_wrong_operation' }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invokeOp = op as any
      const func = invokeOp.func
      if (!func || func.switch().name !== 'hostFunctionTypeInvokeContract') {
        return { isValid: false, invalidReason: 'invalid_exact_stellar_payload_wrong_operation' }
      }

      const invokeArgs = func.invokeContract()
      const contractAddress = Address.fromScAddress(invokeArgs.contractAddress()).toString()
      if (contractAddress !== requirements.asset) {
        return { isValid: false, invalidReason: 'invalid_exact_stellar_payload_wrong_asset' }
      }

      const functionName = invokeArgs.functionName().toString()
      const args = invokeArgs.args()
      if (functionName !== 'transfer' || args.length !== 3) {
        return { isValid: false, invalidReason: 'invalid_exact_stellar_payload_wrong_function_name' }
      }

      const fromAddress = scValToNative(args[0]) as string
      const toAddress = scValToNative(args[1]) as string
      const amount = scValToNative(args[2]) as bigint

      if (toAddress !== requirements.payTo) {
        return { isValid: false, invalidReason: 'invalid_exact_stellar_payload_wrong_recipient', payer: fromAddress }
      }
      if (amount !== BigInt(requirements.amount)) {
        return { isValid: false, invalidReason: 'invalid_exact_stellar_payload_wrong_amount', payer: fromAddress }
      }

      const clientFee = parseInt(transaction.fee, 10)
      if (clientFee > this.maxTransactionFeeStroops) {
        return { isValid: false, invalidReason: 'invalid_exact_stellar_payload_fee_exceeds_maximum', payer: fromAddress }
      }

      // Verify all auth entries are signed (no scvVoid — would mean unsigned)
      for (const auth of (invokeOp.auth ?? [])) {
        const credTypeName = auth.credentials().switch().name
        if (credTypeName === 'sorobanCredentialsAddress') {
          const sig = auth.credentials().address().signature()
          if (sig.switch().name === 'scvVoid') {
            return { isValid: false, invalidReason: 'invalid_exact_stellar_payload_missing_payer_signature', payer: fromAddress }
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
      } as Parameters<typeof TransactionBuilder>[1])
        .setTimeout(requirements.maxTimeoutSeconds ?? 60)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .addOperation(Operation.invokeHostFunction(invokeOp as any))
        .build()

      // 5. Sign with oracle treasury key
      const keypair = Keypair.fromSecret(this.treasurySecret)
      rebuiltTx.sign(keypair)
      const signedXdr = rebuiltTx.toEnvelope().toXDR('base64')

      // 6. Submit via Stellar RPC (native fetch)
      const sendRes = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: { transaction: signedXdr } }),
      })
      const sendJson = await sendRes.json() as { error?: unknown; result?: { status: string; hash: string } }

      if (sendJson.error || sendJson.result?.status !== 'PENDING') {
        console.error('[x402 settle] sendTransaction failed:', JSON.stringify(sendJson))
        return { success: false, errorReason: 'settle_exact_stellar_transaction_submission_failed', network: requirements.network, transaction: '' }
      }

      const txHash = sendJson.result.hash
      console.log('[x402 settle] PENDING, polling for hash:', txHash)

      // 7. Poll for on-chain confirmation (up to 60 s, every 2 s)
      for (let i = 0; i < 30; i++) {
        await new Promise<void>(resolve => setTimeout(resolve, 2000))
        const getRes = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: { hash: txHash } }),
        })
        const getJson = await getRes.json() as { result?: { status: string } }
        const status = getJson.result?.status
        if (status === 'SUCCESS') {
          console.log('[x402 settle] CONFIRMED, tx:', txHash)
          return { success: true, transaction: txHash, network: requirements.network, payer: '' }
        }
        if (status === 'FAILED') {
          console.error('[x402 settle] on-chain FAILED, tx:', txHash)
          return { success: false, errorReason: 'settle_exact_stellar_transaction_failed', network: requirements.network, transaction: txHash }
        }
        // NOT_FOUND = still processing
      }

      console.error('[x402 settle] polling timeout, tx:', txHash)
      return { success: false, errorReason: 'settle_exact_stellar_transaction_timeout', network: requirements.network, transaction: txHash ?? '' }
    } catch (e) {
      console.error('[x402 settle] unexpected error:', e instanceof Error ? e.message : String(e))
      return { success: false, errorReason: 'unexpected_settle_error', network: requirements.network, transaction: '' }
    }
  }
}

export function buildResourceServer(env: Env): x402ResourceServer {
  const network = stellarNetwork(env)
  const localFacilitator = new LocalFacilitator(env.ORACLE_TREASURY_ADDRESS, env.ORACLE_TREASURY_SECRET, network)

  return (new x402ResourceServer(localFacilitator as never)).register(
    network,
    new ServerExactStellarScheme(),
  )
}
