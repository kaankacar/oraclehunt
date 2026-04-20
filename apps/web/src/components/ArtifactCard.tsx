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

export function ArtifactCard({
  consultation,
  ownerLabel,
  ownerHref,
  compactTrace = true,
}: ArtifactCardProps) {
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

      {consultation.artifact_image && (
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

      {consultation.fingerprint && (
        <div className="fingerprint-display mb-4">
          {consultation.fingerprint}
        </div>
      )}

      <p className="text-navy text-sm leading-relaxed whitespace-pre-wrap">
        {consultation.artifact_text}
      </p>

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
