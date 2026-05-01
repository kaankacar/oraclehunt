'use client'

import { startAuthentication } from '@simplewebauthn/browser'
import { PasskeyKit, PasskeyClient } from 'passkey-kit'
import { ChannelsClient } from '@openzeppelin/relayer-plugin-channels'
import * as contract from '@stellar/stellar-sdk/contract'
import {
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
} from '@stellar/stellar-base'
import type { ClientStellarSigner } from '@x402/stellar'
import { getUsdcAddress } from '@x402/stellar'

const IS_MAINNET = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'

const RPC_URL = IS_MAINNET
  ? 'https://soroban-mainnet.stellar.org'
  : 'https://soroban-testnet.stellar.org'

const NETWORK_PASSPHRASE = IS_MAINNET
  ? 'Public Global Stellar Network ; September 2015'
  : 'Test SDF Network ; September 2015'

const USDC_CONTRACT =
  process.env.NEXT_PUBLIC_USDC_CONTRACT ??
  getUsdcAddress(IS_MAINNET ? 'stellar:pubnet' : 'stellar:testnet')
const WORKERS_URL = process.env.NEXT_PUBLIC_WORKERS_URL ?? 'http://localhost:8787'

let _passkeyKit: PasskeyKit | null = null
let _channelsClient: ChannelsClient | null = null

function toBase64Url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function getPasskeyKit(): PasskeyKit {
  if (!_passkeyKit) {
    _passkeyKit = new PasskeyKit({
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      walletWasmHash: process.env.NEXT_PUBLIC_PASSKEY_WALLET_WASM_HASH ?? '',
    })
  }
  return _passkeyKit
}

function getChannelsClient(): ChannelsClient {
  if (!_channelsClient) {
    const baseUrl =
      process.env.NEXT_PUBLIC_OZ_RELAYER_URL ??
      (IS_MAINNET
        ? 'https://channels.openzeppelin.com/mainnet'
        : 'https://channels.openzeppelin.com/testnet')

    _channelsClient = new ChannelsClient({
      baseUrl,
      apiKey: process.env.NEXT_PUBLIC_OZ_RELAYER_API_KEY ?? '',
    })
  }
  return _channelsClient
}

export interface WalletResult {
  contractId: string
  keyIdBase64: string
}

export interface SmolAuthenticationResult extends WalletResult {
  assertion: unknown
}

export interface KnownWallet extends WalletResult {
  username?: string | null
}

/**
 * Create a new passkey-backed Stellar smart wallet.
 * Submits the wallet-creation transaction directly to the Stellar RPC.
 * (OZ Channels is used for ongoing contract calls, not the one-time deploy.)
 */
export async function createWallet(appName: string, username: string): Promise<WalletResult> {
  const kit = getPasskeyKit()
  const { contractId, signedTx, keyIdBase64 } = await kit.createWallet(appName, username, {
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
  })

  // signedTx is a Transaction signed by passkey-kit's internal kalepail keypair.
  // Submit directly to the Stellar RPC — no fee re-processing by a relay.
  const xdr = (signedTx as unknown as { toEnvelope: () => { toXDR: (enc: string) => string } })
    .toEnvelope()
    .toXDR('base64')

  const rpcRes = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: { transaction: xdr },
    }),
  })
  const rpcJson = await rpcRes.json() as { error?: { message: string }; result?: { status: string } }
  if (rpcJson.error) throw new Error(`Wallet creation failed: ${rpcJson.error.message}`)
  if (rpcJson.result?.status === 'ERROR') throw new Error('Wallet creation transaction failed on-chain')

  return { contractId, keyIdBase64 }
}

/**
 * Connect to an existing passkey wallet (prompts biometric).
 */
export async function connectWallet(): Promise<WalletResult> {
  const kit = getPasskeyKit()
  const { contractId, keyIdBase64 } = await kit.connectWallet()
  return { contractId, keyIdBase64 }
}

export async function connectWalletWithOptions(
  opts?: Parameters<PasskeyKit['connectWallet']>[0],
): Promise<WalletResult> {
  const kit = getPasskeyKit()
  const { contractId, keyIdBase64 } = await kit.connectWallet(opts)
  return { contractId, keyIdBase64 }
}

export async function authenticateWalletForSmol(
  expectedContractId: string,
  expectedKeyIdBase64?: string,
): Promise<SmolAuthenticationResult> {
  if (expectedKeyIdBase64) {
    const assertion = await startAuthentication({
      optionsJSON: {
        challenge: toBase64Url('stellaristhebetterblockchain'),
        allowCredentials: [{ id: expectedKeyIdBase64, type: 'public-key' }],
        userVerification: 'preferred',
      },
    })

    return {
      contractId: expectedContractId,
      keyIdBase64: expectedKeyIdBase64,
      assertion,
    }
  }

  const kit = getPasskeyKit()
  const { contractId, keyIdBase64, rawResponse } = await kit.connectWallet({
    getContractId: async () => expectedContractId,
  })

  if (contractId !== expectedContractId) {
    throw new Error('The selected passkey did not resolve to the expected wallet.')
  }
  if (!rawResponse) {
    throw new Error('Passkey authentication did not return a WebAuthn assertion.')
  }

  return {
    contractId,
    keyIdBase64,
    assertion: rawResponse,
  }
}

/**
 * Build an x402 ClientStellarSigner backed by passkey-kit.
 * Only used for non-payment signing; oracle payments use buildPasskeyPaymentScheme.
 */
export function buildX402Signer(contractId: string): ClientStellarSigner {
  const kit = getPasskeyKit()

  return {
    address: contractId,

    signAuthEntry: async (_authEntryXdr: string) => {
      // This path is not used for oracle payments — see buildPasskeyPaymentScheme.
      throw new Error('Use buildPasskeyPaymentScheme for oracle payments')
    },

    signTransaction: async (txXdr: string) => {
      const signed = await kit.sign(txXdr)
      const signedTxXdr =
        typeof signed === 'string'
          ? signed
          : (signed as unknown as { toXDR: () => string }).toXDR()
      return { signedTxXdr, signerAddress: contractId }
    },
  }
}

/**
 * Build a custom x402-compatible payment scheme backed by passkey-kit.
 *
 * ExactStellarScheme.createPaymentPayload calls tx.signAuthEntries({ signAuthEntry }),
 * but stellar-sdk v14 wraps that callback and passes it a HashIdPreimage — not a
 * SorobanAuthorizationEntry. Passkey-kit needs the full entry. The authorizeEntry
 * option bypasses the wrapper entirely, which is how passkey-kit's own sign() works.
 */
export function buildPasskeyPaymentScheme(
  walletContractId: string,
  keyIdBase64: string,
  onProgress?: (event: string) => void,
) {
  const kit = getPasskeyKit()

  return {
    scheme: 'exact' as const,

    async createPaymentPayload(x402Version: number, paymentRequirements: {
      network: string
      payTo: string
      asset: string
      amount: string
      extra: { areFeesSponsored?: boolean }
      maxTimeoutSeconds: number
    }) {
      const { network, payTo, asset, amount, extra, maxTimeoutSeconds } = paymentRequirements

      if (!extra.areFeesSponsored) {
        throw new Error('Exact scheme requires areFeesSponsored to be true')
      }

      const networkPassphrase = network === 'stellar:testnet'
        ? 'Test SDF Network ; September 2015'
        : 'Public Global Stellar Network ; September 2015'

      const rpcUrl = network === 'stellar:testnet'
        ? 'https://soroban-testnet.stellar.org'
        : 'https://soroban-mainnet.stellar.org'

      let stage = 'latest-ledger'

      // Get current ledger for expiration calculation
      onProgress?.('prepare-payment-transaction')
      const latestRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
      })
      const latestJson = await latestRes.json() as { result: { sequence: number } }
      const currentLedger = latestJson.result.sequence
      const maxLedger = currentLedger + Math.ceil(maxTimeoutSeconds / 5)

      // Build the USDC transfer transaction
      stage = 'simulation'
      const tx = await contract.AssembledTransaction.build({
        contractId: asset,
        method: 'transfer',
        args: [
          nativeToScVal(walletContractId, { type: 'address' }),
          nativeToScVal(payTo, { type: 'address' }),
          nativeToScVal(amount, { type: 'i128' }),  // string form matches official ExactStellarScheme
        ],
        networkPassphrase,
        rpcUrl,
        parseResultXdr: (result) => result,
      })

      if (!tx.simulation) throw new Error('Stellar simulation failed')
      if ('error' in tx.simulation) throw new Error(`Stellar simulation failed: ${(tx.simulation as { error: string }).error}`)

      // Sign the assembled transaction using kit.sign(txXdr).
      //
      // Why not call kit.signAuthEntry directly?
      // kit.signAuthEntry expects a SorobanAuthorizationEntry decoded by passkey-kit's
      // own xdr module (its stellar-sdk import). When we pass an entry decoded by OUR
      // stellar-sdk, the nonce (an Int64 instance from our module) gets embedded into
      // passkey-kit's HashIdPreimage. If the two modules diverge (different class
      // registries — possible even with symlinks:true in some webpack configurations),
      // preimage.toXDR() throws "XDR Write Error: [nonce] is not a O".
      //
      // kit.sign(txXdr) avoids this entirely: it calls AssembledTransaction.fromXDR
      // using passkey-kit's own stellar-sdk, producing all-passkey-kit class instances
      // throughout the sign flow. No cross-module boundary is crossed.
      //
      // AssembledTransaction.fromXDR works for arbitrary InvokeHostFunction txs — it
      // only extracts the method name and sets txn.built; it does not validate the spec.
      // kit.sign() needs kit.wallet to be set (it uses wallet.options.contractId
      // as the address for signAuthEntries and wallet.spec for AssembledTransaction.fromXDR).
      // If the user restored their session from localStorage without calling connectWallet(),
      // kit.wallet is undefined. Initialize it here using the provided contractId.
      if (!kit.wallet) {
        onProgress?.('initialize-passkey-client')
        kit.wallet = new PasskeyClient({
          contractId: walletContractId,
          rpcUrl,
          networkPassphrase,
        })
      }

      let txXdr: string
      try {
        // Serialize our assembled (unsigned) tx to base64. At this point auth entries
        // are freshly simulated with no cross-bundle objects, so toXDR() is safe.
        const unsignedTxXdr = tx.toXDR()
        // kit.sign decodes the XDR inside passkey-kit's bundle, signs auth entries
        // there, and returns its own AssembledTransaction with the signed built tx.
        stage = 'passkey-signature'
        onProgress?.('await-passkey-signature')
        const signedTxn = await kit.sign(unsignedTxXdr, { keyId: keyIdBase64, expiration: maxLedger })

        // Extract the signed transaction XDR from passkey-kit's AssembledTransaction.
        const signedTxXdr = (signedTxn as unknown as { toXDR: () => string }).toXDR()

        // The first simulation computed the fee WITHOUT a real signature in the auth
        // entry (signature = scvVoid). The passkey wallet's __check_auth verifies a
        // secp256r1/WebAuthn signature — an expensive operation that is NOT counted in
        // the first simulation. The facilitator re-simulates our signed tx and finds
        // clientFee < minResourceFee → rejects with fee_below_minimum.
        //
        // Fix: update tx.built with the signed transaction, then re-simulate.
        // assembleTransaction (called inside tx.simulate()) preserves existing signed
        // auth entries and only updates sorobanData + fee from the new simulation.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stage = 'resimulation'
        onProgress?.('resimulate-signed-payment')
        tx.built = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase) as any

        await tx.simulate()
        if (!tx.simulation) throw new Error('Re-simulation after signing failed')
        if ('error' in tx.simulation) throw new Error(`Re-simulation after signing failed: ${(tx.simulation as { error: string }).error}`)

        // Return the post-re-simulation XDR — correct fee + signed auth entries.
        txXdr = tx.toXDR()
        onProgress?.('payment-payload-ready')
      } catch (e) {
        const rawMessage = e instanceof Error ? e.message : String(e)
        const message = normalizePaymentError(rawMessage, stage)
        console.error('[x402] createPaymentPayload failed', {
          stage,
          walletContractId,
          payTo,
          asset,
          amount,
          rawMessage,
        })
        throw new Error(message)
      }

      return { x402Version, payload: { transaction: txXdr } }
    },
  }
}

function normalizePaymentError(rawMessage: string, stage: string): string {
  if (rawMessage.includes('op_no_trust') || rawMessage.includes('trustline')) {
    return 'Your wallet cannot pay this oracle yet because the USDC trustline is missing.'
  }

  if (rawMessage.includes('insufficient') || rawMessage.includes('balance')) {
    return 'Your wallet does not have enough USDC to pay this oracle.'
  }

  if (stage === 'passkey-signature') {
    return `The payment request reached passkey signing but the browser did not complete it. (${rawMessage})`
  }

  if (stage === 'simulation') {
    return `The oracle payment simulation failed before signing. (${rawMessage})`
  }

  if (stage === 'resimulation') {
    return `The payment was signed, but re-simulation failed before the paid request could be sent. (${rawMessage})`
  }

  return `The oracle payment failed during ${stage}. (${rawMessage})`
}

function formatTokenAmount(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const fractional = (raw % scale).toString().padStart(decimals, '0').slice(0, 2)
  return `${whole.toString()}.${fractional}`
}

/**
 * Fetch Soroban USDC balance for a Stellar address via the token contract.
 */
export async function getUSDCBalance(stellarAddress: string): Promise<string> {
  try {
    const tx = await contract.AssembledTransaction.build({
      contractId: USDC_CONTRACT,
      method: 'balance',
      args: [nativeToScVal(stellarAddress, { type: 'address' })],
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      parseResultXdr: (result) => scValToNative(result),
    })

    const value = tx.result
    const raw =
      typeof value === 'bigint'
        ? value
        : BigInt(typeof value === 'string' ? value : String(value))

    return formatTokenAmount(raw, 7)
  } catch {
    return '0.00'
  }
}

const FAUCET_SESSION_PREFIX = 'oraclehunt_faucet_attempted:'

export async function maybeSeedTestnetWallet(stellarAddress: string): Promise<boolean> {
  if (IS_MAINNET || typeof window === 'undefined') return false

  const cacheKey = `${FAUCET_SESSION_PREFIX}${stellarAddress}`
  if (sessionStorage.getItem(cacheKey)) return false
  sessionStorage.setItem(cacheKey, '1')

  try {
    const primary = await fetch('/api/faucet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: stellarAddress }),
    })

    if (primary.ok) return true

    const fallback = await fetch(`${WORKERS_URL}/faucet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: stellarAddress }),
    })

    return fallback.ok
  } catch {
    return false
  }
}

/** Truncate a Stellar address for display: GABC...XYZ */
export function truncateAddress(address: string): string {
  if (!address || address.length < 12) return address
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

const WALLET_KEY = 'oraclehunt_wallet'
const KNOWN_WALLETS_KEY = 'oraclehunt_known_wallets'

export function saveWalletToStorage(contractId: string, keyIdBase64: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(WALLET_KEY, JSON.stringify({ contractId, keyIdBase64 }))
  }
}

export function saveKnownWalletToStorage(wallet: KnownWallet) {
  if (typeof window === 'undefined') return

  const existing = loadKnownWalletsFromStorage()
  const next = [
    wallet,
    ...existing.filter(
      (entry) => entry.contractId !== wallet.contractId && entry.keyIdBase64 !== wallet.keyIdBase64,
    ),
  ].slice(0, 8)

  localStorage.setItem(KNOWN_WALLETS_KEY, JSON.stringify(next))
}

export function loadWalletFromStorage(): WalletResult | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(WALLET_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as WalletResult
  } catch {
    return null
  }
}

export function loadKnownWalletsFromStorage(): KnownWallet[] {
  if (typeof window === 'undefined') return []
  const raw = localStorage.getItem(KNOWN_WALLETS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as KnownWallet[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function clearWalletFromStorage() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(WALLET_KEY)
  }
}
