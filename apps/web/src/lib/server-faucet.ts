import { promises as fs } from 'fs'
import path from 'path'
import { contract, nativeToScVal, xdr } from '../../../../node_modules/.pnpm/@stellar+stellar-sdk@14.6.1/node_modules/@stellar/stellar-sdk'
import {
  createEd25519Signer,
  convertToTokenAmount,
  getUsdcAddress,
} from '../../../../node_modules/.pnpm/@x402+stellar@2.9.0/node_modules/@x402/stellar/dist/cjs'

const TESTNET_RPC_URL = 'https://soroban-testnet.stellar.org'
const TESTNET_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
const STARTER_BALANCE = convertToTokenAmount('2.00', 7)

interface FaucetConfig {
  stellarNetwork: string
  treasurySecret: string
  usdcContract: string
}

function parseEnvFile(raw: string): Record<string, string> {
  return raw.split('\n').reduce<Record<string, string>>((acc, line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return acc

    const separator = trimmed.indexOf('=')
    if (separator === -1) return acc

    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (key) acc[key] = value
    return acc
  }, {})
}

async function loadLocalWorkerVars(): Promise<Record<string, string>> {
  const devVarsPath = path.resolve(process.cwd(), '../workers/.dev.vars')
  const raw = await fs.readFile(devVarsPath, 'utf8')
  return parseEnvFile(raw)
}

export async function getServerFaucetConfig(): Promise<FaucetConfig> {
  let treasurySecret = process.env.ORACLE_TREASURY_SECRET
  let usdcContract = process.env.USDC_CONTRACT
  const stellarNetwork = process.env.STELLAR_NETWORK ?? 'testnet'

  if (!treasurySecret || !usdcContract) {
    try {
      const localVars = await loadLocalWorkerVars()
      treasurySecret ||= localVars.ORACLE_TREASURY_SECRET
      usdcContract ||= localVars.USDC_CONTRACT
    } catch {
      // Ignore local-dev fallback errors and validate below.
    }
  }

  if (!treasurySecret) {
    throw new Error('Missing ORACLE_TREASURY_SECRET')
  }

  return {
    stellarNetwork,
    treasurySecret,
    usdcContract: usdcContract ?? getUsdcAddress('stellar:testnet'),
  }
}

export async function fundWalletFromTreasury(walletAddress: string): Promise<string> {
  const { stellarNetwork, treasurySecret, usdcContract } = await getServerFaucetConfig()

  if (stellarNetwork === 'pubnet' || stellarNetwork === 'mainnet') {
    throw new Error('Faucet is disabled on mainnet')
  }

  const signer = createEd25519Signer(treasurySecret, 'stellar:testnet')

  const tx = await contract.AssembledTransaction.build({
    contractId: usdcContract,
    method: 'transfer',
    args: [
      nativeToScVal(signer.address, { type: 'address' }),
      nativeToScVal(walletAddress, { type: 'address' }),
      nativeToScVal(STARTER_BALANCE, { type: 'i128' }),
    ],
    publicKey: signer.address,
    signTransaction: signer.signTransaction,
    networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
    rpcUrl: TESTNET_RPC_URL,
    parseResultXdr: (result: xdr.ScVal) => result,
  })

  const sent = await tx.signAndSend()
  return sent.sendTransactionResponse?.hash ?? ''
}
