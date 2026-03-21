import React from 'react'
const variants = {
  default: 'bg-purple-600 hover:bg-purple-700 text-white',
  outline: 'border border-white/30 text-white hover:bg-white/10',
  ghost:   'text-white hover:bg-white/10',
  destructive: 'bg-red-600 hover:bg-red-700 text-white',
}
const sizes = {
  default: 'px-4 py-2 text-sm',
  sm:   'px-3 py-1.5 text-xs',
  lg:   'px-6 py-3 text-base',
  icon: 'p-2',
}
export function Button({ children, variant='default', size='default', className='', disabled=false, ...props }) {
  return (
    <button disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold
        transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]??variants.default} ${sizes[size]??sizes.default} ${className}`}
      {...props}>
      {children}
    </button>
  )
}
