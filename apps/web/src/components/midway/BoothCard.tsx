'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import Image from 'next/image'
import type { OracleMeta } from '@/types'

interface BoothCardProps {
  oracle: OracleMeta
  index: number
  isConsulted?: boolean
}

export default function BoothCard({ oracle, index, isConsulted = false }: BoothCardProps) {
  const color = oracle.color ?? '#ffffff'
  const hasImage = !!oracle.image

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
      <Link href={`/oracle/${oracle.id}`}>
        <motion.div
          className="group relative h-[480px] w-full cursor-pointer overflow-hidden rounded-lg"
          whileHover={{ scale: 1.02, y: -5 }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.3 }}
          style={{ opacity: isConsulted ? 0.75 : 1 }}
        >
          {hasImage && (
            <>
              <div className="absolute inset-0">
                <Image
                  src={oracle.image!}
                  alt={oracle.name}
                  fill
                  className="object-cover object-top transition-transform duration-700 group-hover:scale-105"
                />
              </div>
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(to top,
                    ${color}90 0%,
                    rgba(10,10,18,0.7) 30%,
                    rgba(10,10,18,0.3) 60%,
                    transparent 100%)`,
                }}
              />
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(to top,
                    rgba(10,10,18,0.95) 0%,
                    rgba(10,10,18,0.6) 25%,
                    transparent 50%)`,
                }}
              />
            </>
          )}

          {!hasImage && (
            <>
              <div className="absolute inset-[1px] rounded-lg bg-gradient-to-b from-midnight-light to-midnight" />
              <div
                className="absolute inset-0 opacity-10"
                style={{
                  backgroundImage: `radial-gradient(${color}40 1px, transparent 1px)`,
                  backgroundSize: '20px 20px',
                }}
              />
            </>
          )}

          <motion.div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
            style={{
              background: `radial-gradient(ellipse at center bottom, ${color}30 0%, transparent 70%)`,
            }}
          />

          <div
            className="absolute inset-0 rounded-lg border-2 transition-colors duration-300"
            style={{
              borderColor: `${color}50`,
              boxShadow: `inset 0 0 0 1px ${color}20`,
            }}
          />
          <div
            className="absolute inset-[4px] rounded-md border transition-colors duration-300"
            style={{ borderColor: `${color}25` }}
          />
          <motion.div
            className="absolute inset-0 rounded-lg border-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{
              borderColor: color,
              boxShadow: `0 0 30px ${color}50, 0 0 60px ${color}30, inset 0 0 30px ${color}15`,
            }}
          />

          {/* Fee badge */}
          <div className="absolute top-4 right-4 z-20">
            <span
              className="px-2 py-1 text-[10px] font-accent tracking-wider uppercase rounded border backdrop-blur-sm"
              style={{
                borderColor: color,
                color: color,
                backgroundColor: 'rgba(10,10,18,0.6)',
              }}
            >
              {oracle.fee}
            </span>
          </div>

          {/* Consulted checkmark */}
          {isConsulted && (
            <div className="absolute top-4 left-4 z-20">
              <span
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-accent tracking-wider uppercase rounded border backdrop-blur-sm"
                style={{
                  borderColor: `${color}80`,
                  color: color,
                  backgroundColor: 'rgba(10,10,18,0.6)',
                }}
              >
                ✓ Consulted
              </span>
            </div>
          )}

          <div className="relative z-10 flex h-full flex-col justify-end p-6">
            {!hasImage && oracle.icon && (
              <motion.div
                className="absolute top-6 left-6 text-4xl"
                animate={{ y: [0, -3, 0] }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: index * 0.2,
                }}
              >
                {oracle.icon}
              </motion.div>
            )}

            <div>
              <h3
                className="text-2xl font-semibold mb-1 transition-colors duration-300 font-title"
                style={{
                  color: '#fff',
                  textShadow: `0 0 30px ${color}, 0 2px 10px rgba(0,0,0,0.8)`,
                }}
              >
                {oracle.name}
              </h3>

              <p
                className="font-accent text-xs tracking-[0.2em] uppercase mb-3"
                style={{ color }}
              >
                {oracle.title ?? oracle.specialty}
              </p>

              <p className="font-body text-sm text-chrome/80 leading-relaxed mb-4">
                {oracle.description}
              </p>

              <motion.div
                className="flex items-center gap-2 font-accent text-xs tracking-wider uppercase"
                style={{ color }}
              >
                <span>Approach</span>
                <motion.span
                  animate={{ x: [0, 5, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                >
                  →
                </motion.span>
              </motion.div>
            </div>
          </div>

          <motion.div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none"
            style={{
              background:
                'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.05) 45%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.05) 55%, transparent 60%)',
            }}
          />

          <motion.div
            className="absolute bottom-0 left-1/2 h-[2px] -translate-x-1/2 rounded-full"
            style={{ backgroundColor: color }}
            initial={{ width: '0%' }}
            whileHover={{ width: '80%' }}
            transition={{ duration: 0.3 }}
          />
        </motion.div>
      </Link>
    </motion.div>
  )
}
