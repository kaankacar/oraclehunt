import type { Metadata } from 'next'
import MidwayScene from '@/components/midway/MidwayScene'

export const metadata: Metadata = {
  title: 'The Midway | Oracle Hunt',
  description: 'Seven hosts await. Choose your fortune at the Midnight Midway.',
}

export default function MidwayPage() {
  return <MidwayScene />
}
