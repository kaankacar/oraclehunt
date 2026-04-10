import { createClient } from '@supabase/supabase-js'

export function createSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

/** Fetch all consultations for a wallet address, ordered by most recent. */
export async function getCodex(stellarAddress: string) {
  const supabase = createSupabaseClient()

  const { data: wallet } = await supabase
    .from('wallets')
    .select('id')
    .eq('stellar_address', stellarAddress)
    .single()

  if (!wallet) return []

  const { data } = await supabase
    .from('consultations')
    .select('*')
    .eq('wallet_id', wallet.id)
    .order('created_at', { ascending: false })

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

  const { data: wallet } = await supabase
    .from('wallets')
    .select('id')
    .eq('stellar_address', stellarAddress)
    .single()

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
  const supabase = createSupabaseClient()

  const [{ data: voter }, { data: target }] = await Promise.all([
    supabase.from('wallets').select('id').eq('stellar_address', voterAddress).single(),
    supabase.from('wallets').select('id').eq('stellar_address', targetAddress).single(),
  ])

  if (!voter || !target) {
    return { success: false, error: 'Wallet not found' }
  }

  const { error } = await supabase.from('votes').insert({
    voter_wallet_id: voter.id,
    target_wallet_id: target.id,
  })

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'You have already voted for this Codex.' }
    }
    return { success: false, error: 'Vote failed. Please try again.' }
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

/** Fetch leaderboard: top by oracles_consulted, top by votes. */
export async function getLeaderboard() {
  const supabase = createSupabaseClient()

  const [byCompletion, byVotes] = await Promise.all([
    supabase
      .from('leaderboard')
      .select('*')
      .order('oracles_consulted', { ascending: false })
      .order('completed_at', { ascending: true, nullsFirst: false })
      .limit(10),
    supabase
      .from('leaderboard')
      .select('*')
      .order('vote_count', { ascending: false })
      .limit(10),
  ])

  return {
    byCompletion: byCompletion.data ?? [],
    byVotes: byVotes.data ?? [],
  }
}
