'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { HIDDEN_ORACLE } from '@/types'

interface HiddenOracleHintProps {
  index: number
  hasClue?: boolean
}

export default function HiddenOracleHint({ index, hasClue = false }: HiddenOracleHintProps) {
  const color = HIDDEN_ORACLE.color ?? '#f0f0ff'

  const card = (
      <motion.div
        className={`group relative h-[480px] w-full overflow-hidden rounded-lg ${hasClue ? 'cursor-pointer' : 'cursor-not-allowed'}`}
        whileHover={{ scale: hasClue ? 1.02 : 1.01, y: hasClue ? -5 : 0 }}
        whileTap={hasClue ? { scale: 0.98 } : undefined}
        transition={{ duration: 0.3 }}
      >
        {HIDDEN_ORACLE.image && (
          <div className="absolute inset-0">
            <Image
              src={HIDDEN_ORACLE.image}
              alt={HIDDEN_ORACLE.name}
              fill
              className="object-cover object-top"
            />
          </div>
        )}

        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to top,
              rgba(10,10,18,0.95) 0%,
              rgba(10,10,18,0.6) 30%,
              transparent 60%)`,
          }}
        />

        <div
          className="absolute inset-0 rounded-lg border-2"
          style={{
            borderColor: `${color}40`,
            boxShadow: `inset 0 0 0 1px ${color}15`,
          }}
        />
        <div
          className="absolute inset-[4px] rounded-md border"
          style={{ borderColor: `${color}20` }}
        />
        <motion.div
          className="absolute inset-0 rounded-lg border-2"
          style={{ borderColor: `${color}50` }}
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
        />

        <div className="relative z-10 flex h-full flex-col justify-end p-6">
          <h3
            className="text-2xl font-semibold mb-1 font-title"
            style={{
              color: 'rgba(255,255,255,0.9)',
              textShadow: `0 0 30px ${color}, 0 2px 10px rgba(0,0,0,0.8)`,
            }}
          >
            <span className="inline-block">
              {HIDDEN_ORACLE.name.split('').map((char, i) => (
                <motion.span
                  key={i}
                  className="inline-block"
                  animate={{
                    opacity: i % 4 === 0 ? [1, 0.6, 1] : 1,
                  }}
                  transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                >
                  {i % 5 === 0 ? '?' : char}
                </motion.span>
              ))}
            </span>
          </h3>

          <p
            className="font-accent text-xs tracking-[0.2em] uppercase mb-3"
            style={{ color }}
          >
            [CONCEALED]
          </p>

          <p className="font-body text-sm text-chrome/80 mb-4">
            {HIDDEN_ORACLE.description}
          </p>

          {hasClue ? (
            <motion.div
              className="flex items-center gap-2 font-accent text-xs tracking-wider uppercase"
              style={{ color }}
              animate={{ opacity: [0.85, 1, 0.85] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <span>I have the phrase</span>
              <motion.span
                animate={{ x: [0, 5, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              >
                →
              </motion.span>
            </motion.div>
          ) : (
            <motion.div
              className="flex items-center gap-2 text-chrome/70"
              animate={{ opacity: [0.7, 0.9, 0.7] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <circle cx="12" cy="16" r="1" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span className="font-accent text-xs tracking-wider">LOCKED</span>
            </motion.div>
          )}
        </div>
      </motion.div>
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.6,
        delay: index * 0.1,
        ease: [0.6, 0.01, 0.05, 0.95] as const,
      }}
    >
      {hasClue ? <Link href="/oracle/hidden">{card}</Link> : card}
    </motion.div>
  )
}
