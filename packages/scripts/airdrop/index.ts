/**
 * Oracle Hunt USDC Airdrop Script
 *
 * Usage:
 *   pnpm start                  # Run airdrop on mainnet
 *   pnpm start --dry-run        # Dry run: log actions without submitting
 *
 * Required env vars (.env):
 *   TREASURY_SECRET   - Stellar secret key of treasury account
 *   USDC_ISSUER       - USDC asset issuer address
 *   STELLAR_NETWORK   - "mainnet" | "testnet"
 *
 * Input CSV: employees.csv with columns: email,stellar_address
 * Output CSV: results.csv with columns: email,stellar_address,status,reason,tx_hash
 */

import 'dotenv/config'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse as parseCsv } from 'csv-parse/sync'
import {
  Keypair,
  Asset,
  TransactionBuilder,
  Operation,
  Networks,
  Horizon,
  BASE_FEE,
} from '@stellar/stellar-sdk'

const DRY_RUN = process.argv.includes('--dry-run')
const AIRDROP_AMOUNT = '2.00'

const TREASURY_SECRET = process.env['TREASURY_SECRET']
const USDC_ISSUER = process.env['USDC_ISSUER']
const STELLAR_NETWORK = process.env['STELLAR_NETWORK'] ?? 'testnet'

if (!TREASURY_SECRET) throw new Error('TREASURY_SECRET is required')
if (!USDC_ISSUER) throw new Error('USDC_ISSUER is required')

const HORIZON_URL =
  STELLAR_NETWORK === 'mainnet'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org'

const NETWORK_PASSPHRASE =
  STELLAR_NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET

const server = new Horizon.Server(HORIZON_URL)
const treasuryKeypair = Keypair.fromSecret(TREASURY_SECRET)
const USDC = new Asset('USDC', USDC_ISSUER)

interface Employee {
  email: string
  stellar_address: string
}

interface Result extends Employee {
  status: 'success' | 'skipped' | 'error'
  reason: string
  tx_hash: string
}

console.log(`\n═══════════════════════════════════════════`)
console.log(`  Oracle Hunt USDC Airdrop`)
console.log(`  Network: ${STELLAR_NETWORK}`)
console.log(`  Treasury: ${treasuryKeypair.publicKey()}`)
console.log(`  Amount per wallet: $${AIRDROP_AMOUNT} USDC`)
console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no transactions)' : 'LIVE'}`)
console.log(`═══════════════════════════════════════════\n`)

async function run() {
  const csvPath = path.resolve('./employees.csv')
  if (!fs.existsSync(csvPath)) {
    throw new Error(`employees.csv not found at ${csvPath}`)
  }

  const raw = fs.readFileSync(csvPath, 'utf-8')
  const employees: Employee[] = parseCsv(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Employee[]

  console.log(`Loaded ${employees.length} employees from employees.csv\n`)

  const results: Result[] = []

  for (const [i, employee] of employees.entries()) {
    const prefix = `[${i + 1}/${employees.length}] ${employee.email} (${employee.stellar_address.slice(0, 8)}…)`

    try {
      // Check if account exists
      let accountExists = true
      try {
        await server.loadAccount(employee.stellar_address)
      } catch {
        accountExists = false
      }

      if (!accountExists) {
        console.log(`${prefix} — SKIP: Account does not exist on Stellar`)
        results.push({
          ...employee,
          status: 'skipped',
          reason: 'Account does not exist',
          tx_hash: '',
        })
        continue
      }

      // Check for USDC trustline
      const account = await server.loadAccount(employee.stellar_address)
      const hasUSDCTrustline = account.balances.some(
        (b) =>
          b.asset_type === 'credit_alphanum4' &&
          b.asset_code === 'USDC' &&
          'asset_issuer' in b &&
          b.asset_issuer === USDC_ISSUER,
      )

      if (!hasUSDCTrustline) {
        console.log(`${prefix} — Establishing USDC trustline…`)
        if (!DRY_RUN) {
          const trustlineHash = await establishTrustline(employee.stellar_address)
          console.log(`${prefix}   Trustline tx: ${trustlineHash}`)
        } else {
          console.log(`${prefix}   [DRY RUN] Would establish trustline`)
        }
      }

      // Send USDC airdrop
      console.log(`${prefix} — Sending $${AIRDROP_AMOUNT} USDC…`)
      let txHash = ''

      if (!DRY_RUN) {
        txHash = await sendUSDC(employee.stellar_address)
        console.log(`${prefix}   ✓ Sent! tx: ${txHash}`)
      } else {
        console.log(`${prefix}   [DRY RUN] Would send $${AIRDROP_AMOUNT} USDC`)
      }

      results.push({
        ...employee,
        status: 'success',
        reason: DRY_RUN ? 'dry-run' : 'sent',
        tx_hash: txHash,
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`${prefix} — ERROR: ${reason}`)
      results.push({ ...employee, status: 'error', reason, tx_hash: '' })
    }
  }

  // Write results CSV
  const resultsPath = path.resolve('./results.csv')
  const csvRows = [
    'email,stellar_address,status,reason,tx_hash',
    ...results.map(
      (r) => `${r.email},${r.stellar_address},${r.status},"${r.reason}",${r.tx_hash}`,
    ),
  ]
  fs.writeFileSync(resultsPath, csvRows.join('\n'))

  // Summary
  const successes = results.filter((r) => r.status === 'success').length
  const skipped = results.filter((r) => r.status === 'skipped').length
  const errors = results.filter((r) => r.status === 'error').length

  console.log(`\n═══════════════════════════════════════════`)
  console.log(`  Summary`)
  console.log(`  ✓ Sent:    ${successes}`)
  console.log(`  ○ Skipped: ${skipped}`)
  console.log(`  ✗ Errors:  ${errors}`)
  console.log(`  Results written to results.csv`)
  if (DRY_RUN) console.log(`  ⚠  DRY RUN — no transactions were submitted`)
  console.log(`═══════════════════════════════════════════\n`)
}

async function establishTrustline(recipientAddress: string): Promise<string> {
  const treasuryAccount = await server.loadAccount(treasuryKeypair.publicKey())

  // Fund the recipient with enough XLM to cover trustline reserve (0.5 XLM base + 0.5 XLM per trustline)
  const tx = new TransactionBuilder(treasuryAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset: USDC,
        source: recipientAddress,
      }),
    )
    .setTimeout(30)
    .build()

  // Note: The recipient must sign the ChangeTrust op.
  // In practice, passkey-kit wallets establish trustlines during wallet creation.
  // This fallback is for legacy Freighter wallets.
  // If the recipient account is a smart wallet (C-address), this path will fail
  // and the trustline must be established via the passkey flow instead.
  throw new Error(
    `Trustline not found for ${recipientAddress}. The wallet owner must establish a USDC trustline via the Oracle Hunt app before airdrop.`,
  )
}

async function sendUSDC(recipientAddress: string): Promise<string> {
  let attempts = 0

  while (attempts < 2) {
    try {
      const treasuryAccount = await server.loadAccount(treasuryKeypair.publicKey())

      const tx = new TransactionBuilder(treasuryAccount, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.payment({
            destination: recipientAddress,
            asset: USDC,
            amount: AIRDROP_AMOUNT,
          }),
        )
        .setTimeout(30)
        .build()

      tx.sign(treasuryKeypair)

      const result = await server.submitTransaction(tx)
      return result.hash
    } catch (err: unknown) {
      // Retry once on sequence number error
      const isSeqError =
        err instanceof Error && err.message.includes('tx_bad_seq')
      if (isSeqError && attempts === 0) {
        attempts++
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }
      throw err
    }
  }

  throw new Error('Failed to submit transaction after retry')
}

run().catch((err) => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
