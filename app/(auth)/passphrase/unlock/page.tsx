'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCrypto } from '@/contexts/CryptoContext'
import { getMemberStatus } from '@/lib/db/auth'
import {
  deriveMasterKey,
  deriveKeypairFromMasterKey,
  unwrapFamilyKey,
  fromBase64,
  toBase64,
} from '@/lib/crypto'

export default function PassphraseUnlockPage() {
  const router = useRouter()
  const { setFamilyKey } = useCrypto()
  const [passphrase, setPassphrase] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleUnlock() {
    if (!passphrase) return
    setLoading(true)
    setError('')

    try {
      const status = await getMemberStatus()

      if (!status.exists || !status.pwhashSalt || !status.publicKey || !status.wrappedFamilyKey) {
        router.replace('/passphrase/setup')
        return
      }

      const salt = fromBase64(status.pwhashSalt)
      const masterKey = await deriveMasterKey(passphrase, salt)
      const { privateKey } = await deriveKeypairFromMasterKey(masterKey)

      const familyKey = await unwrapFamilyKey(
        status.wrappedFamilyKey,
        status.publicKey,
        toBase64(privateKey)
      )

      setFamilyKey(familyKey)
      router.replace('/home')
    } catch {
      setError('Incorrect passphrase. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
      <h2 className="text-xl font-semibold text-stone-900 mb-1">Enter your passphrase</h2>
      <p className="text-stone-500 text-sm mb-6">
        Your vault is locked. Enter your passphrase to access your family's data.
      </p>

      <div className="mb-5">
        <label className="block text-sm font-medium text-stone-700 mb-1">Passphrase</label>
        <input
          type="password"
          value={passphrase}
          onChange={e => setPassphrase(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleUnlock()}
          placeholder="Your vault passphrase"
          autoFocus
          className="w-full border border-stone-300 rounded-lg px-3 py-3 text-stone-900
            focus:outline-none focus:ring-2 focus:ring-green-700 focus:border-green-700"
        />
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <button
        onClick={handleUnlock}
        disabled={loading || !passphrase}
        className="w-full bg-green-800 text-white rounded-lg py-3 font-medium
          disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-900 transition-colors"
      >
        {loading ? 'Unlocking…' : 'Unlock vault'}
      </button>

      <p className="text-stone-400 text-xs text-center mt-6">
        Forgot your passphrase?{' '}
        <a href="/passphrase/recover" className="text-green-800 hover:underline">
          Recover with backup phrase
        </a>
      </p>
    </div>
  )
}
