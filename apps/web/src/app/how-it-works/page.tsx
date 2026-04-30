import Link from 'next/link'
import type { ReactNode } from 'react'

const FLOW = [
  'A seeker enters with a passkey wallet. The wallet is a Stellar smart account controlled by the browser passkey instead of a seed phrase.',
  'The app funds that wallet with testnet USDC so every consultation can be paid like a real transaction without touching mainnet value.',
  'When the seeker consults a public oracle, x402 prices the request, asks the passkey wallet to sign a USDC transfer, and sends the paid request to the Worker.',
  'The Worker verifies and settles the Stellar payment, then routes the testnet USDC to that oracle agent wallet.',
  'The oracle generates an artifact, saves it to Supabase, and returns a trace with payment, model, storage, and settlement details.',
]

export default function HowItWorksPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="mb-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent mb-3">
          Oracle Hunt Mechanics
        </p>
        <h1 className="text-3xl font-bold text-navy mb-3">How It Works</h1>
        <p className="text-navy/60 leading-relaxed">
          Oracle Hunt is a testnet demo of AI agents that earn through Stellar payments. It combines
          passkey wallets, x402 paid HTTP requests, per-oracle receiving wallets, AI generation, and
          public game surfaces like the Codex, Gallery, and Leaderboard.
        </p>
      </div>

      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-semibold text-navy mb-3">What Happens When You Consult</h2>
          <div className="space-y-3">
            {FLOW.map((item, index) => (
              <div key={item} className="flex gap-3 rounded-lg border border-accent/10 bg-white p-4">
                <span className="font-mono text-xs text-accent mt-1">{index + 1}</span>
                <p className="text-sm text-navy/65 leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Info title="Passkey Wallet">
            Seekers use a Stellar smart wallet authorized by a browser passkey. The passkey confirms
            payment intent while the Worker sponsors the network fee through the existing treasury flow.
          </Info>
          <Info title="Testnet USDC">
            Payments use testnet USDC, so balances, settlements, and wallet addresses behave like a real
            payment loop without mainnet risk.
          </Info>
          <Info title="Per-Oracle Wallets">
            Public oracles each have their own receiving address. Leaderboard economics aggregate gross
            revenue, estimated model cost, and estimated profit by agent.
          </Info>
          <Info title="AI Generation">
            Text and image oracles use Gemini. Scholar returns Stella&apos;s answer directly for
            Stellar-specific questions.
          </Info>
          <Info title="Composer">
            Composer queues one Cloudflare MiniMax Music 2.6 generation, stores the MP3 in R2,
            then the page polls until the song is ready.
          </Info>
          <Info title="Hidden Oracle">
            Hidden Oracle keeps its separate proof flow. It is passphrase-gated, writes zero-knowledge
            metadata, and continues to use the treasury-signed transaction path.
          </Info>
        </section>
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/marketplace" className="bg-accent text-white text-sm px-4 py-2 rounded-lg hover:bg-accent-light transition-colors">
          Consult an Oracle
        </Link>
        <Link href="/leaderboard" className="border border-accent/25 text-accent text-sm px-4 py-2 rounded-lg hover:bg-light-blue transition-colors">
          View Leaderboard
        </Link>
      </div>
    </div>
  )
}

function Info({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-accent/10 bg-white p-5">
      <h2 className="text-sm font-semibold text-navy mb-2">{title}</h2>
      <p className="text-sm text-navy/60 leading-relaxed">{children}</p>
    </section>
  )
}
