"use client";

import { motion } from "framer-motion";

interface ScanlinesProps {
  className?: string;
  opacity?: number;
  animate?: boolean;
}

export default function Scanlines({
  className = "",
  opacity = 0.03,
  animate = true,
}: ScanlinesProps) {
  return (
    <motion.div
      className={`pointer-events-none ${className}`}
      style={{
        position: "absolute",
        inset: 0,
        background: `repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          rgba(255, 255, 255, ${opacity}) 2px,
          rgba(255, 255, 255, ${opacity}) 4px
        )`,
      }}
      animate={
        animate
          ? {
              y: [0, 4],
            }
          : undefined
      }
      transition={
        animate
          ? {
              duration: 0.15,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "linear",
            }
          : undefined
      }
    />
  );
}
