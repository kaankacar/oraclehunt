'use client'

import { motion, type HTMLMotionProps } from 'framer-motion'

interface ScanlinesProps {
  className?: string
  opacity?: number
  animate?: boolean
}

export default function Scanlines({
  className = '',
  opacity = 0.03,
  animate = true,
}: ScanlinesProps) {
  const animationProps: Pick<HTMLMotionProps<'div'>, 'animate' | 'transition'> = animate
    ? {
        animate: { y: [0, 4] },
        transition: {
          duration: 0.15,
          repeat: Infinity,
          repeatType: 'reverse',
          ease: 'linear',
        },
      }
    : {}

  return (
    <motion.div
      className={`pointer-events-none ${className}`}
      style={{
        position: 'absolute',
        inset: 0,
        background: `repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          rgba(255, 255, 255, ${opacity}) 2px,
          rgba(255, 255, 255, ${opacity}) 4px
        )`,
      }}
      {...animationProps}
    />
  )
}
