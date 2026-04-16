import { promises as fs } from 'fs'
import path from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

interface ServiceSupabaseConfig {
  url: string
  serviceKey: string
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

export async function getServerSupabaseConfig(): Promise<ServiceSupabaseConfig> {
  let url =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL

  let serviceKey = process.env.SUPABASE_SERVICE_KEY

  if (!url || !serviceKey) {
    try {
      const localVars = await loadLocalWorkerVars()
      url ||= localVars.SUPABASE_URL
      serviceKey ||= localVars.SUPABASE_SERVICE_KEY
    } catch {
      // Ignore local fallback failures and validate below.
    }
  }

  if (!url) throw new Error('Missing SUPABASE_URL')
  if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_KEY')

  return { url, serviceKey }
}

export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const { url, serviceKey } = await getServerSupabaseConfig()
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
