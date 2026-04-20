import {
  Account,
  Address,
  Keypair,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'
import type { Env } from './types'

interface SimulationResult {
  minResourceFee: string
  transactionData: string
  results?: Array<{
    xdr?: string
    auth?: string[]
  }>
}

interface InvokeContractResult {
  txHash: string
  explorerUrl: string
  contractExplorerUrl: string
  returnValueXdr?: string
}

export function isMainnet(env: Env): boolean {
  return env.STELLAR_NETWORK === 'pubnet' || env.STELLAR_NETWORK === 'mainnet'
}

export function getNetworkPassphrase(env: Env): string {
  return isMainnet(env)
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015'
}

export function getRpcUrl(env: Env): string {
  return isMainnet(env)
    ? 'https://soroban-mainnet.stellar.org'
    : 'https://soroban-testnet.stellar.org'
}

export function getHorizonUrl(env: Env): string {
  return isMainnet(env)
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org'
}

export function getExplorerNetwork(env: Env): 'public' | 'testnet' {
  return isMainnet(env) ? 'public' : 'testnet'
}

export function getTxExplorerUrl(env: Env, txHash: string): string {
  return `https://stellar.expert/explorer/${getExplorerNetwork(env)}/tx/${txHash}`
}

export function getContractExplorerUrl(env: Env, contractId: string): string {
  return `https://stellar.expert/explorer/${getExplorerNetwork(env)}/contract/${contractId}`
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function invokeTreasuryContract(
  env: Env,
  contractId: string,
  functionName: string,
  args: xdr.ScVal[],
): Promise<InvokeContractResult> {
  if (!env.ORACLE_TREASURY_SECRET) {
    throw new Error('Missing ORACLE_TREASURY_SECRET')
  }

  const treasuryKeypair = Keypair.fromSecret(env.ORACLE_TREASURY_SECRET)
  const treasuryAddress = treasuryKeypair.publicKey()
  const sequence = await getAccountSequence(env, treasuryAddress)

  const buildOp = (authEntries: xdr.SorobanAuthorizationEntry[]) =>
    Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(contractId).toScAddress(),
          functionName,
          args,
        }),
      ),
      auth: authEntries,
    })

  const unsignedTx = new TransactionBuilder(new Account(treasuryAddress, sequence), {
    fee: '100',
    networkPassphrase: getNetworkPassphrase(env),
  } as ConstructorParameters<typeof TransactionBuilder>[1])
    .addOperation(buildOp([]))
    .setTimeout(60)
    .build()

  const simulation = await simulateTransaction(env, unsignedTx.toEnvelope().toXDR('base64'))
  const authEntries = (simulation.results?.[0]?.auth ?? []).map((entry) =>
    xdr.SorobanAuthorizationEntry.fromXDR(entry, 'base64'),
  )

  const finalFee = (parseInt(simulation.minResourceFee, 10) + 100).toString()
  const finalTx = new TransactionBuilder(new Account(treasuryAddress, sequence), {
    fee: finalFee,
    networkPassphrase: getNetworkPassphrase(env),
    sorobanData: simulation.transactionData,
  } as ConstructorParameters<typeof TransactionBuilder>[1])
    .addOperation(buildOp(authEntries))
    .setTimeout(60)
    .build()

  finalTx.sign(treasuryKeypair)

  const txHash = await sendAndWait(env, finalTx.toEnvelope().toXDR('base64'))
  return {
    txHash,
    explorerUrl: getTxExplorerUrl(env, txHash),
    contractExplorerUrl: getContractExplorerUrl(env, contractId),
    returnValueXdr: simulation.results?.[0]?.xdr,
  }
}

async function getAccountSequence(env: Env, address: string): Promise<string> {
  const response = await fetch(`${getHorizonUrl(env)}/accounts/${address}`)
  if (!response.ok) {
    throw new Error(`Failed to load account sequence for ${address}`)
  }

  const account = await response.json() as { sequence: string }
  return account.sequence
}

async function simulateTransaction(env: Env, transaction: string): Promise<SimulationResult> {
  const response = await fetch(getRpcUrl(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: { transaction },
    }),
  })
  const json = await response.json() as {
    result?: SimulationResult
    error?: { message?: string }
  }

  if (json.error || !json.result) {
    throw new Error(`Simulation failed: ${json.error?.message ?? 'unknown error'}`)
  }

  return json.result
}

async function sendAndWait(env: Env, transaction: string): Promise<string> {
  const sendResponse = await fetch(getRpcUrl(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: { transaction },
    }),
  })
  const sendJson = await sendResponse.json() as {
    result?: { status?: string; hash?: string }
    error?: { message?: string } | unknown
  }

  if (sendJson.error || sendJson.result?.status !== 'PENDING' || !sendJson.result.hash) {
    throw new Error(`sendTransaction failed: ${JSON.stringify(sendJson)}`)
  }

  const txHash = sendJson.result.hash

  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const response = await fetch(getRpcUrl(env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: { hash: txHash },
      }),
    })
    const json = await response.json() as {
      result?: { status?: string }
    }

    if (json.result?.status === 'SUCCESS') {
      return txHash
    }

    if (json.result?.status === 'FAILED') {
      throw new Error(`Transaction failed on-chain: ${txHash}`)
    }
  }

  throw new Error(`Transaction timed out: ${txHash}`)
}
