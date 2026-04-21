import { promises as fs } from 'fs'
import path from 'path'
import { Keypair } from '@stellar/stellar-sdk'
import type { Env } from '../../../workers/src/types'

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

function requiredValue(record: Record<string, string | undefined>, key: keyof Env): string {
  const value = record[key]
  if (!value) throw new Error(`Missing ${key}`)
  return value
}

export async function getHiddenOracleEnv(): Promise<Env> {
  const localVars: Record<string, string> = await loadLocalWorkerVars().catch(() => ({} as Record<string, string>))
  const merged: Record<string, string | undefined> = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? localVars.GEMINI_API_KEY,
    ORACLE_TREASURY_SECRET: process.env.ORACLE_TREASURY_SECRET ?? localVars.ORACLE_TREASURY_SECRET,
    USDC_CONTRACT: process.env.USDC_CONTRACT ?? localVars.USDC_CONTRACT,
    FINGERPRINT_SALT: process.env.FINGERPRINT_SALT ?? localVars.FINGERPRINT_SALT,
    SUPABASE_URL: process.env.SUPABASE_URL ?? localVars.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ?? localVars.SUPABASE_SERVICE_KEY,
    ZK_CONTRACT_ID: process.env.ZK_CONTRACT_ID ?? localVars.ZK_CONTRACT_ID,
    HIDDEN_ORACLE_VERIFIER_CONTRACT_ID: process.env.HIDDEN_ORACLE_VERIFIER_CONTRACT_ID ?? localVars.HIDDEN_ORACLE_VERIFIER_CONTRACT_ID,
    INFORMANT_PASSPHRASE: process.env.INFORMANT_PASSPHRASE ?? localVars.INFORMANT_PASSPHRASE,
    STELLAR_NETWORK: process.env.STELLAR_NETWORK ?? localVars.STELLAR_NETWORK ?? 'testnet',
    ADMIN_CORS_ORIGIN: process.env.ADMIN_CORS_ORIGIN ?? localVars.ADMIN_CORS_ORIGIN,
  }

  const treasurySecret = requiredValue(merged, 'ORACLE_TREASURY_SECRET')

  return {
    GEMINI_API_KEY: requiredValue(merged, 'GEMINI_API_KEY'),
    ORACLE_TREASURY_ADDRESS: Keypair.fromSecret(treasurySecret).publicKey(),
    ORACLE_TREASURY_SECRET: treasurySecret,
    USDC_CONTRACT: requiredValue(merged, 'USDC_CONTRACT'),
    FINGERPRINT_SALT: requiredValue(merged, 'FINGERPRINT_SALT'),
    SUPABASE_URL: requiredValue(merged, 'SUPABASE_URL'),
    SUPABASE_SERVICE_KEY: requiredValue(merged, 'SUPABASE_SERVICE_KEY'),
    ZK_CONTRACT_ID: requiredValue(merged, 'ZK_CONTRACT_ID'),
    HIDDEN_ORACLE_VERIFIER_CONTRACT_ID: requiredValue(merged, 'HIDDEN_ORACLE_VERIFIER_CONTRACT_ID'),
    INFORMANT_PASSPHRASE: requiredValue(merged, 'INFORMANT_PASSPHRASE'),
    STELLAR_NETWORK: merged.STELLAR_NETWORK ?? 'testnet',
    ...(merged.ADMIN_CORS_ORIGIN ? { ADMIN_CORS_ORIGIN: merged.ADMIN_CORS_ORIGIN } : {}),
  }
}
