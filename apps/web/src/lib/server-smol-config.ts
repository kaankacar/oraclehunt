import { promises as fs } from 'fs'
import path from 'path'

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

export async function getSmolApiBase(): Promise<string> {
  const localVars = await loadLocalWorkerVars().catch(() => ({} as Record<string, string>))
  const base =
    process.env.SMOL_API_URL
    ?? process.env.NEXT_PUBLIC_SMOL_API_URL
    ?? localVars.SMOL_API_URL
    ?? 'https://api.smol.xyz'

  return base.replace(/\/+$/, '')
}

export function getSmolNetwork(): 'mainnet' | 'testnet' {
  const network =
    process.env.STELLAR_NETWORK
    ?? process.env.NEXT_PUBLIC_STELLAR_NETWORK
    ?? 'testnet'

  return network === 'mainnet' ? 'mainnet' : 'testnet'
}
