import React from 'react'
import { motion } from 'framer-motion'
const EFFECTS = [
  { id: 'none',      label: 'Normal',    emoji: '🎙️' },
  { id: 'chipmunk',  label: 'Chipmunk',  emoji: '🐿️' },
  { id: 'helium',    label: 'Helium',    emoji: '🎈' },
  { id: 'robot',     label: 'Robot',     emoji: '🤖' },
  { id: 'deep_echo', label: 'Deep Echo', emoji: '🌊' },
]
export default function VoiceEffectPicker({ activeEffect, onSelect }) {
  return (
    <div className="space-y-2">
      <p className="text-[#DCE7FF]/70 text-xs text-center font-medium tracking-wide uppercase">Voice Effect</p>
      <div className="grid grid-cols-5 gap-2">
        {EFFECTS.map(effect => (
          <motion.button key={effect.id} whileTap={{ scale: 0.92 }} onClick={() => onSelect(effect.id)}
            className={`flex flex-col items-center gap-1 rounded-2xl py-2 px-1 border transition-all text-center
              ${activeEffect === effect.id
                ? 'bg-purple-500/50 border-purple-400/70 shadow-lg shadow-purple-500/20'
                : 'bg-white/10 border-white/20 hover:bg-white/20'}`}>
            <span className="text-xl">{effect.emoji}</span>
            <span className="text-[#DCE7FF] text-[10px] font-semibold leading-tight">{effect.label}</span>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
