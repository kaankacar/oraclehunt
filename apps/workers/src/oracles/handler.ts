import { createClient } from '@supabase/supabase-js'
import { ORACLE_PROMPTS, PAINTER_IMAGE_PROMPT } from './prompts'
import type { OracleId, Env, OracleRequest, OracleResponse } from '../types'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const TEXT_MODEL = 'gemini-2.5-flash'
const IMAGE_MODEL = 'gemini-2.5-flash-image'

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>
  error?: { message: string }
}

async function geminiText(apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch(`${GEMINI_BASE}/${TEXT_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    }),
  })
  const json = await res.json() as GeminiResponse
  if (json.error) throw new Error(`Gemini error: ${json.error.message}`)
  return json.candidates?.[0]?.content?.parts?.find(p => p.text)?.text ?? ''
}

async function geminiImage(
  apiKey: string,
  prompt: string,
): Promise<{ text: string; imageDataUrl?: string }> {
  const res = await fetch(`${GEMINI_BASE}/${IMAGE_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  })
  const json = await res.json() as GeminiResponse
  if (json.error) throw new Error(`Gemini error: ${json.error.message}`)

  const parts = json.candidates?.[0]?.content?.parts ?? []
  const text = parts.find(p => p.text)?.text ?? ''
  const img = parts.find(p => p.inlineData)?.inlineData
  const imageDataUrl = img ? `data:${img.mimeType};base64,${img.data}` : undefined
  return { text, imageDataUrl }
}

export async function handleOracle(
  oracleId: OracleId,
  req: OracleRequest,
  env: Env,
  txHash?: string,
): Promise<OracleResponse> {
  let artifact: string
  let artifactImage: string | undefined

  if (oracleId === 'painter') {
    const { text, imageDataUrl } = await geminiImage(
      env.GEMINI_API_KEY,
      `${PAINTER_IMAGE_PROMPT}\n\nSubject: ${req.prompt}`,
    )
    artifact = text || 'Your pixel art portrait has been rendered.'
    artifactImage = imageDataUrl
  } else {
    artifact = await geminiText(env.GEMINI_API_KEY, ORACLE_PROMPTS[oracleId], req.prompt)
  }

  const timestamp = new Date().toISOString()

  // Save to Supabase — upsert the wallet first so consultations are never silently dropped
  // (wallet row may be missing if the user reconnected without going through the creation flow)
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)

  const { data: wallet } = await supabase
    .from('wallets')
    .select('id')
    .eq('stellar_address', req.walletAddress)
    .single()

  if (wallet) {
    await supabase.from('consultations').insert({
      wallet_id: wallet.id,
      oracle_id: oracleId,
      prompt: req.prompt,
      artifact_text: artifact,
      tx_hash: txHash ?? null,
    })
  }

  return { artifact, artifactImage, oracleId, txHash, timestamp }
}
