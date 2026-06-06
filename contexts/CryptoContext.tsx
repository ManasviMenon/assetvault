'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

interface CryptoCtx {
  familyKey: Uint8Array | null
  setFamilyKey: (key: Uint8Array) => void
  clearKeys: () => void
}

const CryptoContext = createContext<CryptoCtx | null>(null)

export function CryptoProvider({ children }: { children: ReactNode }) {
  const [familyKey, setFamilyKeyState] = useState<Uint8Array | null>(null)

  return (
    <CryptoContext.Provider value={{
      familyKey,
      setFamilyKey: (key) => setFamilyKeyState(key),
      clearKeys: () => setFamilyKeyState(null),
    }}>
      {children}
    </CryptoContext.Provider>
  )
}

export function useCrypto() {
  const ctx = useContext(CryptoContext)
  if (!ctx) throw new Error('useCrypto must be used within CryptoProvider')
  return ctx
}
