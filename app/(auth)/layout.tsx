import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Wordmark */}
        <div className="text-center mb-10">
          <h1 className="text-2xl font-semibold text-green-900 tracking-tight">Virasat</h1>
          <p className="text-stone-500 text-sm mt-1">Your family's financial home</p>
        </div>
        {children}
      </div>
    </div>
  )
}
