export type OracleId = 'seer' | 'painter' | 'composer' | 'scribe' | 'scholar' | 'informant'

export interface Env {
  ANTHROPIC_API_KEY: string
  ORACLE_TREASURY_ADDRESS: string
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
  oracleId: OracleId | 'hidden'
  txHash?: string
  timestamp: string
}

export interface HiddenOracleResponse {
  fingerprint: string
  zkPortrait: string
  txHash?: string
  timestamp: string
}
