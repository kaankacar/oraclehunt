export type OracleId = 'seer' | 'painter' | 'composer' | 'scribe' | 'scholar' | 'informant'
export type OraclePersonality = 'default' | 'sassy' | 'slam_poet' | 'crypto_degen'

export interface Env {
  GEMINI_API_KEY: string
  ORACLE_TREASURY_ADDRESS: string
  ORACLE_TREASURY_SECRET?: string
  USDC_CONTRACT: string
  FINGERPRINT_SALT: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  ZK_CONTRACT_ID: string
  HIDDEN_ORACLE_VERIFIER_CONTRACT_ID: string
  INFORMANT_PASSPHRASE: string
  STELLAR_NETWORK: string
  SMOL_API_URL?: string
  ADMIN_CORS_ORIGIN?: string
  STELLA_API_URL?: string
  STELLA_API_KEY?: string
  WORKERS_PUBLIC_URL?: string
  ORACLE_WALLET_SEER?: string
  ORACLE_WALLET_PAINTER?: string
  ORACLE_WALLET_COMPOSER?: string
  ORACLE_WALLET_SCRIBE?: string
  ORACLE_WALLET_SCHOLAR?: string
  ORACLE_WALLET_INFORMANT?: string
}

export interface OracleRequest {
  prompt: string
  walletAddress: string
  personality?: OraclePersonality
}

export interface OracleResponse {
  artifact: string
  artifactImage?: string  // base64 data URL, present for image-generating oracles (e.g. painter)
  audioUrl1?: string | null
  audioUrl2?: string | null
  oracleId: OracleId | 'hidden'
  txHash?: string
  explorerUrl?: string
  processingTrace: ProcessingTraceStep[]
  timestamp: string
}

export interface ComposerPendingResponse {
  status: 'pending'
  oracleId: 'composer'
  jobId: string
  txHash?: string
  explorerUrl?: string
  processingTrace: ProcessingTraceStep[]
  timestamp: string
}

export interface ComposerAuthRequiredResponse {
  status: 'smol-auth-required'
  oracleId: 'composer'
  txHash?: string
  explorerUrl?: string
  processingTrace: ProcessingTraceStep[]
  timestamp: string
}

export interface ComposerErrorResponse {
  status: 'error'
  oracleId: 'composer'
  error: string
  txHash?: string
  explorerUrl?: string
  processingTrace: ProcessingTraceStep[]
  timestamp: string
}

export interface HiddenOracleResponse {
  fingerprint: string
  zkPortrait: string
  artifactImage?: string
  txHash?: string
  explorerUrl?: string
  contractExplorerUrl?: string
  fingerprintContractExplorerUrl?: string
  zkContractId?: string
  zkTxHash?: string
  zkVerifyTxHash?: string
  processingTrace: ProcessingTraceStep[]
  timestamp: string
}

export interface HiddenOracleChallengeResponse {
  challengeId: string
  nonce: string
  saltField: string
  expectedFingerprintField: string
  deriveTxHash: string
  deriveExplorerUrl: string
  fingerprintContractExplorerUrl: string
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
