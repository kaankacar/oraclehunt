export type OracleId = 'seer' | 'painter' | 'composer' | 'scribe' | 'scholar' | 'informant' | 'hidden'
export type OraclePersonality = 'default' | 'sassy' | 'slam_poet' | 'crypto_degen'

export interface OracleMeta {
  id: OracleId
  name: string
  specialty: string
  emoji: string
  fee: string
  description: string
  locked?: boolean

  // Midnight Midway design fields
  title?: string
  longDescription?: string
  color?: string
  glowClass?: string
  textGlowClass?: string
  icon?: string
  image?: string
  isBonus?: boolean
}

export const ORACLES: OracleMeta[] = [
  {
    id: 'seer',
    name: 'The Seer',
    specialty: 'Personalized prophecies',
    emoji: '🔮',
    fee: '$0.10',
    description: 'A prophet machine that gathers a few details about you and returns a grand, poetic glimpse of the year ahead.',
    title: 'Host of Prophecy',
    longDescription: 'A masked prophecy automaton draped in velvet darkness. Holographic sigils pulse with magenta light as ancient algorithms divine what lies ahead. Step closer, if you dare to know.',
    color: '#ff2d95',
    glowClass: 'glow-seer',
    textGlowClass: 'text-glow-seer',
    icon: '👁',
    image: '/images/the_seer.png',
  },
  {
    id: 'painter',
    name: 'The Painter',
    specialty: 'Pixel portrait in words',
    emoji: '🎨',
    fee: '$0.10',
    description: 'A pixel-forging portraitist that turns a person, place, or passing thought into a vivid scene.',
    title: 'Host of Portraits',
    longDescription: 'Part arcade cabinet, part forge altar. Cyan sparks fly as holographic pixels assemble on an ethereal easel. The Painter sees not your face, but your essence—and renders it in light.',
    color: '#00e5ff',
    glowClass: 'glow-painter',
    textGlowClass: 'text-glow-painter',
    icon: '🎨',
    image: '/images/the_painter.png',
  },
  {
    id: 'composer',
    name: 'The Composer',
    specialty: 'Original song hooks',
    emoji: '🎵',
    fee: '$0.15',
    description: 'A melody-spinning midway musician that transforms a theme into an original tune.',
    title: 'Host of Melodies',
    longDescription: 'A melody-spinning carnival bandleader machine. Chrome calliope meets synth organ as violet and cyan pulses dance through pneumatic tubes. Your anthem awaits composition.',
    color: '#9d4edd',
    glowClass: 'glow-composer',
    textGlowClass: 'text-glow-composer',
    icon: '🎵',
    image: '/images/the_composer.png',
  },
  {
    id: 'scribe',
    name: 'The Scribe',
    specialty: 'Haiku & short poetry',
    emoji: '📜',
    fee: '$0.05',
    description: 'A quiet poetic automaton that listens closely, then answers only in haiku.',
    title: 'Host of Words',
    longDescription: 'A poetic stenographer automaton of quiet precision. Amber light pools on ancient mechanisms as delicate paper charms emerge, inscribed with verses meant only for you.',
    color: '#ffb347',
    glowClass: 'glow-scribe',
    textGlowClass: 'text-glow-scribe',
    icon: '✒',
    image: '/images/the_scribe2.png',
  },
  {
    id: 'scholar',
    name: 'Stella',
    specialty: 'Stellar answers from Stella',
    emoji: '✨',
    fee: '$0.10',
    description: 'Ask about Stellar, SDF, Soroban, Lumens, or ecosystem lore. Stella answers directly from its Stellar knowledge base.',
    title: 'Host of Stellar Knowledge',
    longDescription: 'A Stellar-native knowledge host that answers directly from Stella. Ask about SDF, Soroban, Lumens, ecosystem history, or protocol details.',
    color: '#4a9eff',
    glowClass: 'glow-scholar',
    textGlowClass: 'text-glow-scholar',
    icon: '✨',
    image: '/images/the_scholar.png',
  },
  {
    id: 'informant',
    name: 'The Informant',
    specialty: 'Cryptic clues',
    emoji: '🕵️',
    fee: '$0.15',
    description: 'A sly whisper-machine that never speaks plainly; every answer is a riddle, and every riddle hides a clue.',
    title: 'Host of Secrets',
    longDescription: 'A sly trickster clue-machine dwelling in perpetual shadow. Glitch flickers reveal fragmented signage and mirrored surfaces. What it offers may lead you somewhere... unexpected.',
    color: '#39ff14',
    glowClass: 'glow-informant',
    textGlowClass: 'text-glow-informant',
    icon: '🔮',
    image: '/images/the_informant.png',
  },
]

export const HIDDEN_ORACLE: OracleMeta = {
  id: 'hidden',
  name: 'The Hidden Host',
  specialty: 'Sacred proofs',
  emoji: '🗝️',
  fee: '???',
  description: 'A secret proof chamber of sacred-tech geometry. Clean silver-white light emanates from within, but the way is concealed. Only those who seek shall find.',
  locked: true,
  title: 'Host of Proofs',
  longDescription: 'A secret chamber of proof and verification, revealed only to those who uncover the phrase and complete the trial.',
  color: '#f0f0ff',
  glowClass: 'glow-oracle',
  textGlowClass: 'text-glow-oracle',
  icon: '✧',
  image: '/images/hidden_oracle.png',
}

export const ALL_ORACLES: OracleMeta[] = [...ORACLES, HIDDEN_ORACLE]

export const PROGRESS_ORACLE_IDS = ['seer', 'painter', 'composer', 'scribe', 'scholar'] as const
export const PUBLIC_ORACLE_IDS = ['seer', 'painter', 'composer', 'scribe', 'scholar', 'informant'] as const
export const PERSONALITY_ORACLE_IDS = ['seer', 'scribe', 'informant'] as const

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
  audio_url_1?: string | null
  audio_url_2?: string | null
  smol_job_id?: string | null
  tx_hash: string | null
  processing_trace: ProcessingTraceStep[]
  fingerprint?: string | null
  zk_contract_id?: string | null
  zk_tx_hash?: string | null
  zk_verify_tx_hash?: string | null
  payment_amount_usdc?: number | null
  estimated_model_cost_usdc?: number | null
  estimated_profit_usdc?: number | null
  oracle_wallet_address?: string | null
  ai_provider?: string | null
  ai_model?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  total_tokens?: number | null
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
