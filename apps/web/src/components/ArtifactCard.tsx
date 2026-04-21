'use client'

import type { Consultation } from '@/types'
import { TraceTimeline } from './TraceTimeline'

const ORACLE_EMOJI: Record<string, string> = {
  seer: '🔮',
  painter: '🎨',
  composer: '🎵',
  scribe: '📜',
  scholar: '📚',
  informant: '🕵️',
  hidden: '🗝️',
}

const ORACLE_NAME: Record<string, string> = {
  seer: 'The Seer',
  painter: 'The Painter',
  composer: 'The Composer',
  scribe: 'The Scribe',
  scholar: 'The Scholar',
  informant: 'The Informant',
  hidden: 'The Hidden Oracle',
}

interface ArtifactCardProps {
  consultation: Consultation
  ownerLabel?: string
  ownerHref?: string
  compactTrace?: boolean
}

function getHiddenOraclePortrait(consultation: Consultation): string {
  const raw = consultation.artifact_text.trim()
  if (consultation.oracle_id !== 'hidden') return raw

  return raw
    .replace(/^FINGERPRINT:\s*[0-9a-f]+\s*/i, '')
    .replace(/^\s+/, '')
}

export function ArtifactCard({
  consultation,
  ownerLabel,
  ownerHref,
  compactTrace = true,
}: ArtifactCardProps) {
  const hiddenPortrait = getHiddenOraclePortrait(consultation)

  return (
    <div className={`artifact-card p-5 shadow-sm ${consultation.oracle_id === 'hidden' ? 'border-l-navy' : ''}`}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-base">{ORACLE_EMOJI[consultation.oracle_id] ?? '✦'}</span>
        <span className="text-xs font-semibold text-accent uppercase tracking-wide">
          {ORACLE_NAME[consultation.oracle_id] ?? consultation.oracle_id}
        </span>
        <span className="text-xs text-navy/30 ml-auto font-mono">
          {new Date(consultation.created_at).toLocaleString()}
        </span>
      </div>

      {ownerLabel && ownerHref && (
        <a href={ownerHref} className="text-xs text-accent hover:text-accent-light underline inline-block mb-3">
          {ownerLabel}
        </a>
      )}

      <p className="text-navy/50 text-xs italic mb-3 whitespace-pre-wrap">&ldquo;{consultation.prompt}&rdquo;</p>

      {consultation.artifact_image && consultation.oracle_id !== 'hidden' && (
        <div className="mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={consultation.artifact_image}
            alt={`${ORACLE_NAME[consultation.oracle_id] ?? 'Oracle'} artifact`}
            className="w-full rounded-lg image-rendering-pixelated"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      )}

      {consultation.oracle_id === 'hidden' ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-accent/10 bg-light-blue/50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent mb-2">
              What Happened Technically
            </p>
            <p className="text-sm text-navy/75 leading-relaxed">
              Your browser proved knowledge of the hidden phrase without sending the phrase to the
              worker. Soroban verified that BN254 proof on-chain against your wallet-bound
              fingerprint, and only after that did the Oracle generate the portrait. The
              fingerprint below is the real on-chain artifact. Use the execution trace for the
              contract and transaction links.
            </p>
          </div>

          {consultation.fingerprint && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-accent mb-2">
                Your Soroban Fingerprint
              </p>
              <div className="fingerprint-display">
                {consultation.fingerprint}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-accent mb-2">
              Your Oracle Portrait
            </p>
            {consultation.artifact_image && (
              <div className="mb-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={consultation.artifact_image}
                  alt="Hidden Oracle portrait"
                  className="w-full rounded-lg"
                />
              </div>
            )}
            {hiddenPortrait && (
              <p className="text-navy text-sm leading-relaxed whitespace-pre-wrap">
                {hiddenPortrait}
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          {consultation.fingerprint && (
            <div className="fingerprint-display mb-4">
              {consultation.fingerprint}
            </div>
          )}

          <p className="text-navy text-sm leading-relaxed whitespace-pre-wrap">
            {consultation.artifact_text}
          </p>

          {consultation.oracle_id === 'composer' && (consultation.audio_url_1 || consultation.audio_url_2) && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {consultation.audio_url_1 && (
                <div className="rounded-xl border border-accent/10 bg-light-blue/40 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent mb-2">
                    Variation 1
                  </p>
                  <audio controls preload="none" className="w-full" src={consultation.audio_url_1} />
                </div>
              )}

              {consultation.audio_url_2 && (
                <div className="rounded-xl border border-accent/10 bg-light-blue/40 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent mb-2">
                    Variation 2
                  </p>
                  <audio controls preload="none" className="w-full" src={consultation.audio_url_2} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {consultation.processing_trace?.length > 0 && (
        <div className="mt-4">
          <TraceTimeline
            steps={consultation.processing_trace}
            title="What happened in the background"
            variant={compactTrace ? 'compact' : 'full'}
          />
        </div>
      )}
    </div>
  )
}
