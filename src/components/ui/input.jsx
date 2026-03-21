import React from 'react'
export function Input({ className='', ...props }) {
  return (
    <input className={`w-full px-4 py-2.5 rounded-xl bg-white/10 border border-white/20
      text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500/60
      transition-all duration-150 text-sm ${className}`} {...props} />
  )
}
