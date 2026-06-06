'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCrypto } from '@/contexts/CryptoContext'
import type { ReactNode } from 'react'

export default function KeyGuard({ children }: { children: ReactNode }) {
  const { familyKey } = useCrypto()
  const router = useRouter()

  useEffect(() => {
    if (familyKey === null) {
      router.replace('/passphrase/unlock')
    }
  }, [familyKey, router])

  if (familyKey === null) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-stone-400 text-sm">Unlocking vault…</p>
      </div>
    )
  }

  return <>{children}</>
}
