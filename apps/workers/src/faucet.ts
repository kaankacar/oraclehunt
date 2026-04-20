import {
  TransactionBuilder,
  Account,
  Operation,
  xdr,
  Address,
  Keypair,
  nativeToScVal,
} from '@stellar/stellar-sdk'
import { convertToTokenAmount } from '@x402/stellar'
import type { Env } from './types'

const TESTNET_RPC_URL = 'https://soroban-testnet.stellar.org'
const TESTNET_HORIZON_URL = 'https://horizon-testnet.stellar.org'
const TESTNET_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'

export async function fundTestnetWallet(walletAddress: string, env: Env): Promise<string> {
  if (env.STELLAR_NETWORK === 'pubnet') throw new Error('Faucet is disabled on mainnet')
  if (!env.ORACLE_TREASURY_SECRET) throw new Error('Missing ORACLE_TREASURY_SECRET')

  const keypair = Keypair.fromSecret(env.ORACLE_TREASURY_SECRET)
  const treasuryAddress = keypair.publicKey()
  const amount = BigInt(convertToTokenAmount('2.00', 7))

  // 1. Get treasury sequence from Horizon
  const accRes = await fetch(`${TESTNET_HORIZON_URL}/accounts/${treasuryAddress}`)
  if (!accRes.ok) throw new Error('Treasury account not found on testnet')
  const { sequence } = await accRes.json() as { sequence: string }

  // Helper: build the invokeHostFunction op for USDC transfer
  const buildOp = (authEntries: xdr.SorobanAuthorizationEntry[]) =>
    Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(env.USDC_CONTRACT).toScAddress(),
          functionName: 'transfer',
          args: [
            nativeToScVal(treasuryAddress, { type: 'address' }),
            nativeToScVal(walletAddress, { type: 'address' }),
            nativeToScVal(amount, { type: 'i128' }),
          ],
        })
      ),
      auth: authEntries,
    })

  // 2. Build unsigned tx for simulation (no sorobanData yet)
  const unsignedTx = new TransactionBuilder(new Account(treasuryAddress, sequence), {
    fee: '100',
    networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
  } as ConstructorParameters<typeof TransactionBuilder>[1])
    .addOperation(buildOp([]))
    .setTimeout(60)
    .build()

  // 3. Simulate to get sorobanData + resource fee + auth entries
  const simRes = await fetch(TESTNET_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'simulateTransaction',
      params: { transaction: unsignedTx.toEnvelope().toXDR('base64') },
    }),
  })
  const simJson = await simRes.json() as {
    result?: {
      minResourceFee: string
      transactionData: string
      results?: Array<{ auth?: string[] }>
    }
    error?: { message: string }
  }
  if (simJson.error) throw new Error(`Simulation failed: ${simJson.error.message}`)

  const { minResourceFee, transactionData, results } = simJson.result!
  const authEntries = (results?.[0]?.auth ?? []).map(a =>
    xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64')
  )
  const finalFee = parseInt(minResourceFee) + 100

  // 4. Rebuild with sorobanData, correct fee, and auth entries from simulation
  const finalTx = new TransactionBuilder(new Account(treasuryAddress, sequence), {
    fee: finalFee.toString(),
    networkPassphrase: TESTNET_NETWORK_PASSPHRASE,
    sorobanData: transactionData,
  } as ConstructorParameters<typeof TransactionBuilder>[1])
    .addOperation(buildOp(authEntries))
    .setTimeout(60)
    .build()

  finalTx.sign(keypair)
  const signedXdr = finalTx.toEnvelope().toXDR('base64')

  // 5. Submit via Stellar RPC
  const sendRes = await fetch(TESTNET_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'sendTransaction',
      params: { transaction: signedXdr },
    }),
  })
  const sendJson = await sendRes.json() as { result?: { status: string; hash: string }; error?: unknown }
  if (sendJson.error || sendJson.result?.status !== 'PENDING') {
    throw new Error(`sendTransaction failed: ${JSON.stringify(sendJson)}`)
  }
  const txHash = sendJson.result!.hash

  // 6. Poll for on-chain confirmation (up to 60s)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const getRes = await fetch(TESTNET_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getTransaction',
        params: { hash: txHash },
      }),
    })
    const getJson = await getRes.json() as { result?: { status: string } }
    if (getJson.result?.status === 'SUCCESS') return txHash
    if (getJson.result?.status === 'FAILED') throw new Error('Faucet transaction failed on-chain')
  }
  throw new Error('Faucet transaction timed out')
}
