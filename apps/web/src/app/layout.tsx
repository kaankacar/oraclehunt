import type { Metadata } from 'next'
import './globals.css'
import { WalletProvider } from '@/components/WalletProvider'
import { Nav } from '@/components/Nav'

export const metadata: Metadata = {
  title: 'Oracle Hunt',
  description: 'Consult AI Oracles. Collect artifacts. Find the hidden one.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Nav />
          <main className="pt-14 min-h-screen">{children}</main>
        </WalletProvider>
      </body>
    </html>
  )
}
