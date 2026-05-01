import Link from 'next/link'
import type { ReactNode } from 'react'

const EXPERIENCE_STEPS = [
  {
    title: 'Enter the Midway',
    body: 'Create or reconnect a passkey wallet, choose a username, and receive testnet USDC so you can try the full payment flow without spending real funds.',
  },
  {
    title: 'Choose a host',
    body: 'Each Midway host is an AI oracle with a different specialty: prophecy, images, music with lyrics, poetry, Stellar knowledge from Stella, or riddles.',
  },
  {
    title: 'Approve one small payment',
    body: 'When you ask a question, your browser asks for passkey approval. That approval signs a testnet USDC payment for the oracle consultation.',
  },
  {
    title: 'Watch the receipt',
    body: 'The app shows a live trace of what happened: payment approval, Stellar settlement, AI generation, and Codex storage. Composer has its own six-step music trace because it runs asynchronously.',
  },
  {
    title: 'Collect and compare',
    body: 'Your result becomes an artifact in your Codex. Public artifacts appear in the Gallery, where people can vote on individual pieces.',
  },
]

const TECH_DETAILS = [
  {
    title: 'Passkeys, not seed phrases',
    body: 'A browser passkey controls a Stellar smart account. Users get a familiar biometric or device prompt instead of handling private keys directly.',
  },
  {
    title: 'x402 paid requests',
    body: 'Public oracle calls are HTTP requests that carry payment requirements. The frontend signs the USDC payment, then retries the request with proof of payment.',
  },
  {
    title: 'Real settlement on testnet',
    body: 'The Worker verifies the x402 payment and settles testnet USDC to the receiving wallet configured for that oracle agent.',
  },
  {
    title: 'Different AI providers',
    body: 'Seer, Scribe, and Informant use OpenAI GPT-5.4 mini. Painter uses GPT Image 2 with selectable styles. Stella answers directly from its Stellar knowledge service, and Composer submits one fal.ai ACE-Step music job.',
  },
  {
    title: 'Codex, Gallery, Leaderboard',
    body: 'Supabase stores wallets, consultations, traces, votes, and leaderboard views. Seeker rankings combine core-oracle progress and artifact votes.',
  },
  {
    title: 'Hidden Oracle proof',
    body: 'The Hidden Oracle is separate from paid public hosts. The browser generates a local Groth16 proof, and Soroban verifies it without posting the raw phrase as normal app input.',
  },
]

export default function HowItWorksPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <div className="mb-10 max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent mb-3">
          Oracle Hunt Mechanics
        </p>
        <h1 className="text-3xl font-bold text-navy mb-3">How It Works</h1>
        <p className="text-navy/65 leading-relaxed">
          Oracle Hunt is a playable Stellar testnet demo. It lets people experience passkey
          smart wallets, USDC payments, AI agents, public collectibles, and a zero-knowledge
          unlock without needing to read protocol docs first. The technical details are visible
          for anyone who wants them, but the main path is meant to be understandable without
          knowing Stellar, x402, or zero-knowledge proofs in advance.
        </p>
      </div>

      <div className="space-y-10">
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-navy mb-2">The Short Version</h2>
            <p className="text-sm text-navy/55 leading-relaxed">
              You enter the Midway, ask AI hosts for artifacts, pay with testnet USDC, and build
              a public Codex. Think of each consultation as buying a small ticket: your passkey
              approves it, the host produces something, and the artifact is saved for others to see.
            </p>
          </div>
          <div className="grid gap-3">
            {EXPERIENCE_STEPS.map((item, index) => (
              <Step key={item.title} index={index + 1} title={item.title}>
                {item.body}
              </Step>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-navy mb-2">What Is Happening Underneath</h2>
            <p className="text-sm text-navy/55 leading-relaxed">
              For technical readers, each consultation is also a traceable payment and execution
              path across the browser, Cloudflare Worker, Stellar testnet, AI providers, and Supabase.
              The Hidden Oracle adds local proof generation in the browser plus Soroban verification.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {TECH_DETAILS.map((item) => (
              <Info key={item.title} title={item.title}>
                {item.body}
              </Info>
            ))}
          </div>
        </section>

      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/midway" className="bg-accent text-white text-sm px-4 py-2 rounded-lg hover:bg-accent-light transition-colors">
          Enter the Midway
        </Link>
        <Link href="/gallery" className="border border-accent/25 text-accent text-sm px-4 py-2 rounded-lg hover:bg-light-blue transition-colors">
          View Gallery
        </Link>
        <Link href="/leaderboard" className="border border-accent/25 text-accent text-sm px-4 py-2 rounded-lg hover:bg-light-blue transition-colors">
          View Leaderboard
        </Link>
      </div>
    </div>
  )
}

function Step({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <section className="flex gap-4 rounded-lg border border-accent/10 bg-white p-4">
      <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 font-mono text-xs text-accent">
        {index}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-navy mb-1">{title}</h3>
        <p className="text-sm text-navy/60 leading-relaxed">{children}</p>
      </div>
    </section>
  )
}

function Info({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-accent/10 bg-white p-5">
      <h3 className="text-sm font-semibold text-navy mb-2">{title}</h3>
      <p className="text-sm text-navy/60 leading-relaxed">{children}</p>
    </section>
  )
}
