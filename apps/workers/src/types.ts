export type OracleId = 'seer' | 'painter' | 'composer' | 'scribe' | 'scholar' | 'informant'

export interface Env {
  GEMINI_API_KEY: string
  ORACLE_TREASURY_ADDRESS: string
  ORACLE_TREASURY_SECRET?: string
  USDC_CONTRACT: string
  FINGERPRINT_SALT: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  ZK_CONTRACT_ID: string
  INFORMANT_PASSPHRASE: string
  STELLAR_NETWORK: string
  ADMIN_CORS_ORIGIN?: string
}

export interface OracleRequest {
  prompt: string
  walletAddress: string
}

export interface OracleResponse {
  artifact: string
  artifactImage?: string  // base64 data URL, present for image-generating oracles (e.g. painter)
  oracleId: OracleId | 'hidden'
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
  zkContractId?: string
  zkTxHash?: string
  zkVerifyTxHash?: string
  processingTrace: ProcessingTraceStep[]
  timestamp: string
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
