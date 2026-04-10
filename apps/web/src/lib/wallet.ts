'use client'

import { PasskeyKit } from 'passkey-kit'
import { ChannelsClient } from '@openzeppelin/relayer-plugin-channels'
import { Horizon, xdr as stellarXdr } from '@stellar/stellar-sdk'
import type { ClientStellarSigner } from '@x402/stellar'

const IS_MAINNET = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'

const RPC_URL = IS_MAINNET
  ? 'https://soroban-mainnet.stellar.org'
  : 'https://soroban-testnet.stellar.org'

const NETWORK_PASSPHRASE = IS_MAINNET
  ? 'Public Global Stellar Network ; September 2015'
  : 'Test SDF Network ; September 2015'

const HORIZON_URL = IS_MAINNET
  ? 'https://horizon.stellar.org'
  : 'https://horizon-testnet.stellar.org'

const USDC_ISSUER = IS_MAINNET
  ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
  : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

let _passkeyKit: PasskeyKit | null = null
let _channelsClient: ChannelsClient | null = null

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

/**
 * Create a new passkey-backed Stellar smart wallet.
 * Submits the wallet-creation transaction directly to the Stellar RPC.
 * (OZ Channels is used for ongoing contract calls, not the one-time deploy.)
 */
export async function createWallet(appName: string, username: string): Promise<WalletResult> {
  const kit = getPasskeyKit()
  const { contractId, signedTx, keyIdBase64 } = await kit.createWallet(appName, username)

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

/**
 * Build an x402 ClientStellarSigner backed by passkey-kit.
 *
 * passkey-kit works with SorobanAuthorizationEntry objects, while the
 * SEP-43 interface (used by x402) works with base64 XDR strings.
 * This function bridges the two.
 */
export function buildX402Signer(contractId: string): ClientStellarSigner {
  const kit = getPasskeyKit()

  return {
    address: contractId,

    // SEP-43 signAuthEntry: receives base64 XDR string, returns { signedAuthEntry: string }
    signAuthEntry: async (authEntryXdr: string) => {
      // Decode base64 XDR string → SorobanAuthorizationEntry object.
      // passkey-kit and @x402/stellar use different patch versions of stellar-base,
      // so we cast through unknown to sidestep the incompatible XDR type versions.
      // At runtime the structures are identical.
      const entry = stellarXdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64')
      const signed = await kit.signAuthEntry(entry as unknown as Parameters<typeof kit.signAuthEntry>[0])
      return {
        signedAuthEntry: (signed as unknown as { toXDR: (enc: string) => string }).toXDR('base64'),
        signerAddress: contractId,
      }
    },

    // SEP-43 signTransaction: receives XDR string, returns { signedTxXdr: string }
    signTransaction: async (txXdr: string) => {
      // kit.sign() accepts a raw XDR string and returns the signed AssembledTransaction
      const signed = await kit.sign(txXdr)

      // Extract the signed XDR
      const signedTxXdr =
        typeof signed === 'string'
          ? signed
          : (signed as unknown as { toXDR: () => string }).toXDR()

      return { signedTxXdr, signerAddress: contractId }
    },
  }
}

/**
 * Fetch USDC balance for a Stellar address via Horizon.
 */
export async function getUSDCBalance(stellarAddress: string): Promise<string> {
  const horizon = new Horizon.Server(HORIZON_URL)
  try {
    const account = await horizon.loadAccount(stellarAddress)
    const usdcBalance = account.balances.find(
      (b) =>
        b.asset_type === 'credit_alphanum4' &&
        b.asset_code === 'USDC' &&
        'asset_issuer' in b &&
        b.asset_issuer === USDC_ISSUER,
    )
    return usdcBalance ? parseFloat(usdcBalance.balance).toFixed(2) : '0.00'
  } catch {
    return '0.00'
  }
}

/** Truncate a Stellar address for display: GABC...XYZ */
export function truncateAddress(address: string): string {
  if (!address || address.length < 12) return address
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

const WALLET_KEY = 'oraclehunt_wallet'

export function saveWalletToStorage(contractId: string, keyIdBase64: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(WALLET_KEY, JSON.stringify({ contractId, keyIdBase64 }))
  }
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

export function clearWalletFromStorage() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(WALLET_KEY)
  }
}
