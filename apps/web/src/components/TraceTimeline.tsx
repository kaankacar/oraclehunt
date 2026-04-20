'use client'

import { useMemo, useState } from 'react'
import type { ProcessingTraceStep } from '@/types'

interface TraceTimelineProps {
  steps: ProcessingTraceStep[]
  title?: string
  variant?: 'full' | 'compact'
  defaultExpanded?: boolean
}

function statusGlyph(status: ProcessingTraceStep['status']) {
  switch (status) {
    case 'success':
      return '●'
    case 'error':
      return '×'
    default:
      return '◌'
  }
}

function statusClass(status: ProcessingTraceStep['status']) {
  switch (status) {
    case 'success':
      return 'text-green-600'
    case 'error':
      return 'text-red-500'
    default:
      return 'text-accent'
  }
}

export function TraceTimeline({
  steps,
  title = 'Background State',
  variant = 'full',
  defaultExpanded,
}: TraceTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? variant === 'full')
  const completed = useMemo(
    () => steps.filter((step) => step.status === 'success').length,
    [steps],
  )

  if (steps.length === 0) return null

  return (
    <div className={`rounded-xl border border-accent/10 bg-light-blue/60 ${variant === 'compact' ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-navy/55">{title}</p>
          {variant === 'compact' && (
            <p className="text-xs text-navy/45 mt-1">
              {completed}/{steps.length} steps completed
            </p>
          )}
        </div>
        {variant === 'compact' && (
          <button
            onClick={() => setIsExpanded((value) => !value)}
            className="text-xs text-accent hover:text-accent-light transition-colors"
          >
            {isExpanded ? 'Hide details' : 'Show details'}
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="mt-4 space-y-3">
          {steps.map((step) => (
            <div key={step.id} className="flex gap-3 items-start">
              <div className={`mt-0.5 text-xs ${statusClass(step.status)}`}>
                {statusGlyph(step.status)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-navy">{step.label}</p>
                {step.detail && (
                  <p className="text-xs text-navy/55 mt-1 leading-relaxed">{step.detail}</p>
                )}
                {!!step.links?.length && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {step.links.map((link) => (
                      <a
                        key={`${step.id}:${link.url}:${link.label}`}
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent hover:text-accent-light underline"
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
