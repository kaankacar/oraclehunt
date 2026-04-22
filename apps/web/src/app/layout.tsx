import type { Metadata } from 'next'
import { Cinzel, Space_Grotesk, Orbitron, Cormorant_Garamond, Inter } from 'next/font/google'
import './globals.css'
import { WalletProvider } from '@/components/WalletProvider'
import { Nav } from '@/components/Nav'

const cinzel = Cinzel({
  variable: '--font-cinzel',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
})

const orbitron = Orbitron({
  variable: '--font-orbitron',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
})

const cormorantGaramond = Cormorant_Garamond({
  variable: '--font-cormorant',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
})

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'Oracle Hunt',
  description: 'Consult AI Oracles. Collect artifacts. Find the hidden one.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${cinzel.variable} ${spaceGrotesk.variable} ${orbitron.variable} ${cormorantGaramond.variable} ${inter.variable}`}
    >
      <body>
        <WalletProvider>
          <Nav />
          <main className="pt-14 min-h-screen">{children}</main>
        </WalletProvider>
      </body>
    </html>
  )
}
