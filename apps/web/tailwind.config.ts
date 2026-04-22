import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#17161F',
        accent: '#6157FF',
        'light-blue': '#F6F0E8',
        'accent-light': '#C8C1FF',
        midnight: {
          DEFAULT: '#0a0a12',
          light: '#12121f',
          lighter: '#1a1a2e',
        },
        velvet: {
          DEFAULT: '#1a1025',
          light: '#2a1a3a',
        },
        chrome: {
          DEFAULT: '#c0c0d0',
          bright: '#e8e8f0',
          dim: '#8080a0',
        },
        seer: { DEFAULT: '#ff2d95', glow: '#ff2d9540' },
        painter: { DEFAULT: '#00e5ff', glow: '#00e5ff40' },
        composer: { DEFAULT: '#9d4edd', glow: '#9d4edd40' },
        scribe: { DEFAULT: '#ffb347', glow: '#ffb34740' },
        scholar: { DEFAULT: '#4a9eff', glow: '#4a9eff40' },
        informant: { DEFAULT: '#39ff14', glow: '#39ff1440' },
        oracle: { DEFAULT: '#f0f0ff', glow: '#f0f0ff40' },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        display: ['var(--font-cinzel)', 'Georgia', 'serif'],
        body: ['var(--font-space-grotesk)', 'system-ui', 'sans-serif'],
        accent: ['var(--font-orbitron)', 'system-ui', 'sans-serif'],
        title: ['var(--font-cormorant)', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}

export default config
