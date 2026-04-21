import { createClient } from '@supabase/supabase-js'
import { PROGRESS_ORACLE_IDS, type OracleId } from '@/types'

export function createSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

async function getPublicWalletRecord(stellarAddress: string) {
  const supabase = createSupabaseClient()
  const { data } = await supabase
    .from('wallet_profiles_public')
    .select('id, username')
    .eq('stellar_address', stellarAddress)
    .maybeSingle()

  return data ?? null
}

/** Fetch all consultations for a wallet address, ordered by most recent. */
export async function getCodex(stellarAddress: string) {
  const supabase = createSupabaseClient()
  const wallet = await getPublicWalletRecord(stellarAddress)

  if (!wallet) return []

  const { data } = await supabase
    .from('consultations')
    .select('*')
    .eq('wallet_id', wallet.id)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getOracleHistory(stellarAddress: string, oracleId: OracleId) {
  const supabase = createSupabaseClient()
  const wallet = await getPublicWalletRecord(stellarAddress)

  if (!wallet) return []

  const { data } = await supabase
    .from('consultations')
    .select('*')
    .eq('wallet_id', wallet.id)
    .eq('oracle_id', oracleId)
    .order('created_at', { ascending: false })
    .limit(12)

  return data ?? []
}

/** Get the set of unique oracle IDs consulted by a wallet. */
export async function getConsultedOracles(stellarAddress: string): Promise<Set<string>> {
  const consultations = await getCodex(stellarAddress)
  return new Set(consultations.map((c: { oracle_id: string }) => c.oracle_id))
}

/** Get vote count for a wallet's Codex. */
export async function getVoteCount(stellarAddress: string): Promise<number> {
  const supabase = createSupabaseClient()
  const wallet = await getPublicWalletRecord(stellarAddress)

  if (!wallet) return 0

  const { count } = await supabase
    .from('votes')
    .select('*', { count: 'exact', head: true })
    .eq('target_wallet_id', wallet.id)

  return count ?? 0
}

/** Cast a vote for a Codex. Returns error message if vote fails. */
export async function castVote(
  voterAddress: string,
  targetAddress: string,
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch('/api/votes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voterAddress, targetAddress }),
  })

  let payload: { error?: string } = {}
  try {
    payload = await response.json() as { error?: string }
  } catch {
    payload = {}
  }

  if (!response.ok) {
    return { success: false, error: payload.error ?? 'Vote failed. Please try again.' }
  }

  return { success: true }
}

/** Fetch all public Codexes for the gallery. */
export async function getGallery() {
  const supabase = createSupabaseClient()

  const { data } = await supabase
    .from('leaderboard')
    .select('*')
    .order('vote_count', { ascending: false })
    .limit(200)

  return data ?? []
}

/** Fetch individual public artifacts for the gallery feed. */
export async function getGalleryArtifacts() {
  const supabase = createSupabaseClient()

  const { data } = await supabase
    .from('gallery_artifacts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300)

  return data ?? []
}

export async function getPublicDisplayName(stellarAddress: string): Promise<string | null> {
  const supabase = createSupabaseClient()
  const { data: leaderboardEntry } = await supabase
    .from('leaderboard')
    .select('display_name')
    .eq('stellar_address', stellarAddress)
    .maybeSingle()

  if (leaderboardEntry?.display_name) {
    return leaderboardEntry.display_name
  }

  const wallet = await getPublicWalletRecord(stellarAddress)
  return wallet?.username ?? null
}

/** Fetch leaderboard: top by oracles_consulted, top by votes. */
export async function getLeaderboard() {
  const supabase = createSupabaseClient()

  const [{ data: profiles }, { data: consultations }, { data: votes }] = await Promise.all([
    supabase
      .from('wallet_profiles_public')
      .select('id, stellar_address, username'),
    supabase
      .from('consultations')
      .select('wallet_id, oracle_id, created_at')
      .in('oracle_id', [...PROGRESS_ORACLE_IDS]),
    supabase
      .from('votes')
      .select('target_wallet_id'),
  ])

  const profilesList = profiles ?? []
  const consultationList = consultations ?? []
  const voteList = votes ?? []

  const consultedByWallet = new Map<string, Set<string>>()
  const completionMomentByWallet = new Map<string, string>()

  const consultationGroups = new Map<string, Array<{ oracle_id: string; created_at: string }>>()
  for (const consultation of consultationList) {
    const existing = consultationGroups.get(consultation.wallet_id) ?? []
    existing.push(consultation)
    consultationGroups.set(consultation.wallet_id, existing)
  }

  for (const [walletId, walletConsultations] of consultationGroups) {
    const earliestByOracle = new Map<string, string>()

    for (const consultation of walletConsultations) {
      const previous = earliestByOracle.get(consultation.oracle_id)
      if (!previous || consultation.created_at < previous) {
        earliestByOracle.set(consultation.oracle_id, consultation.created_at)
      }
    }

    const consulted = new Set(earliestByOracle.keys())
    consultedByWallet.set(walletId, consulted)

    const completionTimestamps = Array.from(earliestByOracle.values()).sort((a, b) => a.localeCompare(b))
    if (completionTimestamps.length >= PROGRESS_ORACLE_IDS.length) {
      const completedAt = completionTimestamps[PROGRESS_ORACLE_IDS.length - 1]
      if (completedAt) {
        completionMomentByWallet.set(walletId, completedAt)
      }
    }
  }

  const voteCountByWallet = new Map<string, number>()
  for (const vote of voteList) {
    voteCountByWallet.set(
      vote.target_wallet_id,
      (voteCountByWallet.get(vote.target_wallet_id) ?? 0) + 1,
    )
  }

  const allEntries = profilesList
    .map((profile) => {
      const consulted = consultedByWallet.get(profile.id) ?? new Set<string>()
      const oraclesConsulted = consulted.size

      return {
        stellar_address: profile.stellar_address,
        display_name: profile.username,
        oracles_consulted: oraclesConsulted,
        is_complete: oraclesConsulted >= PROGRESS_ORACLE_IDS.length,
        completed_at: completionMomentByWallet.get(profile.id) ?? null,
        vote_count: voteCountByWallet.get(profile.id) ?? 0,
      }
    })
    .sort((a, b) => {
      if (b.oracles_consulted !== a.oracles_consulted) return b.oracles_consulted - a.oracles_consulted

      if (a.completed_at && b.completed_at && a.completed_at !== b.completed_at) {
        return a.completed_at.localeCompare(b.completed_at)
      }
      if (a.completed_at && !b.completed_at) return -1
      if (!a.completed_at && b.completed_at) return 1

      if (b.vote_count !== a.vote_count) return b.vote_count - a.vote_count

      const aName = a.display_name ?? a.stellar_address
      const bName = b.display_name ?? b.stellar_address
      return aName.localeCompare(bName)
    })

  return {
    allEntries,
  }
}
