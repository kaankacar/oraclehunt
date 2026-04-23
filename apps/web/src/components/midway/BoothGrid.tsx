'use client'

import { ORACLES } from '@/types'
import BoothCard from './BoothCard'
import HiddenOracleHint from './HiddenOracleHint'

interface BoothGridProps {
  consulted: Set<string>
}

export default function BoothGrid({ consulted }: BoothGridProps) {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex flex-wrap justify-center gap-10">
        {ORACLES.map((oracle, index) => (
          <div
            key={oracle.id}
            className="w-full sm:w-[calc(50%-20px)] lg:w-[calc(33.333%-27px)] xl:w-[calc(25%-30px)]"
          >
            <BoothCard oracle={oracle} index={index} isConsulted={consulted.has(oracle.id)} />
          </div>
        ))}

        <div className="w-full sm:w-[calc(50%-20px)] lg:w-[calc(33.333%-27px)] xl:w-[calc(25%-30px)]">
          <HiddenOracleHint index={ORACLES.length} hasClue={consulted.has('informant')} />
        </div>
      </div>
    </div>
  )
}
