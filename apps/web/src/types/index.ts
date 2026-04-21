export type OracleId = 'seer' | 'painter' | 'composer' | 'scribe' | 'scholar' | 'informant' | 'hidden'

export interface OracleMeta {
  id: OracleId
  name: string
  specialty: string
  emoji: string
  fee: string
  description: string
  locked?: boolean
}

export const ORACLES: OracleMeta[] = [
  {
    id: 'seer',
    name: 'The Seer',
    specialty: 'Personalized prophecies',
    emoji: '🔮',
    fee: '$0.10',
    description: 'Describe yourself and receive a grand, poetic prophecy for the year ahead.',
  },
  {
    id: 'painter',
    name: 'The Painter',
    specialty: 'Pixel portrait in words',
    emoji: '🎨',
    fee: '$0.10',
    description: 'Describe a person or scene and receive a vivid pixel-art portrait.',
  },
  {
    id: 'composer',
    name: 'The Composer',
    specialty: 'Original song hooks',
    emoji: '🎵',
    fee: '$0.15',
    description: 'Name a theme and receive a hook, bridge, and first verse of an original song.',
  },
  {
    id: 'scribe',
    name: 'The Scribe',
    specialty: 'Haiku & short poetry',
    emoji: '📜',
    fee: '$0.05',
    description: 'Tell it anything. It responds only in haiku.',
  },
  {
    id: 'scholar',
    name: 'The Scholar',
    specialty: 'Stellar trivia & lore',
    emoji: '📚',
    fee: '$0.10',
    description: 'Ask about Stellar, SDF, or Lumens. Answers arrive as ancient scrolls.',
  },
  {
    id: 'informant',
    name: 'The Informant',
    specialty: 'Cryptic clues',
    emoji: '🕵️',
    fee: '$0.15',
    description: 'Speaks in riddles. Hidden in its answers: the clue to the Hidden Oracle.',
  },
]

export const PROGRESS_ORACLE_IDS = ['seer', 'painter', 'composer', 'scribe', 'scholar'] as const

export function isProgressOracleId(oracleId: OracleId | string): oracleId is typeof PROGRESS_ORACLE_IDS[number] {
  return PROGRESS_ORACLE_IDS.includes(oracleId as typeof PROGRESS_ORACLE_IDS[number])
}

export interface Consultation {
  id: string
  wallet_id: string
  oracle_id: OracleId
  prompt: string
  artifact_text: string
  artifact_image?: string | null
  tx_hash: string | null
  processing_trace: ProcessingTraceStep[]
  fingerprint?: string | null
  zk_contract_id?: string | null
  zk_tx_hash?: string | null
  zk_verify_tx_hash?: string | null
  created_at: string
}

export interface WalletState {
  address: string | null
  balance: string | null
  isConnected: boolean
}

export interface TraceLink {
  label: string
  url: string
}

export interface ProcessingTraceStep {
  id: string
  label: string
  status: 'pending' | 'success' | 'error'
  detail?: string
  txHash?: string
  links?: TraceLink[]
}
