'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useCrypto } from '@/contexts/CryptoContext'
import { getMemberStatus } from '@/lib/db/auth'
import { recoverFromBackupPhrase, openSealedRecoveryEnvelope } from '@/lib/crypto'
import type { EncryptedRecord } from '@/lib/crypto'

export default function PassphraseRecoverPage() {
  const router = useRouter()
  const { setFamilyKey } = useCrypto()
  const [phrase, setPhrase] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleRecover() {
    const words = phrase.trim().toLowerCase().split(/\s+/)
    if (words.length !== 24) {
      setError(`Enter all 24 words. You entered ${words.length}.`)
      return
    }

    setLoading(true)
    setError('')

    try {
      const status = await getMemberStatus()
      if (!status.exists || !status.recoveryEnvelope) {
        setError('No recovery data found for this account.')
        setLoading(false)
        return
      }

      const recoveryKey = await recoverFromBackupPhrase(words.join(' '))
      const envelope: EncryptedRecord = JSON.parse(status.recoveryEnvelope)
      const familyKey = await openSealedRecoveryEnvelope(envelope, recoveryKey)

      setFamilyKey(familyKey)
      router.replace('/home')
    } catch {
      setError('Recovery failed. Check that every word is correct and in the right order.')
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
      <h2 className="text-xl font-semibold text-stone-900 mb-1">Recover with backup phrase</h2>
      <p className="text-stone-500 text-sm mb-6">
        Enter your 24-word backup phrase exactly as it was shown during setup. Words are
        separated by spaces, all lowercase.
      </p>

      <div className="mb-5">
        <label className="block text-sm font-medium text-stone-700 mb-1">
          24-word backup phrase
        </label>
        <textarea
          value={phrase}
          onChange={e => setPhrase(e.target.value)}
          placeholder="word1 word2 word3 … word24"
          rows={4}
          className="w-full border border-stone-300 rounded-lg px-3 py-3 text-stone-900
            placeholder-stone-400 font-mono text-sm resize-none
            focus:outline-none focus:ring-2 focus:ring-green-700 focus:border-green-700"
        />
        <p className="text-stone-400 text-xs mt-1">
          {phrase.trim() ? `${phrase.trim().split(/\s+/).length} / 24 words` : '0 / 24 words'}
        </p>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <button
        onClick={handleRecover}
        disabled={loading || phrase.trim().split(/\s+/).length !== 24}
        className="w-full bg-green-800 text-white rounded-lg py-3 font-medium
          disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-900 transition-colors"
      >
        {loading ? 'Recovering…' : 'Recover vault access'}
      </button>

      <p className="text-stone-400 text-xs text-center mt-6">
        <Link href="/passphrase/unlock" className="text-green-800 hover:underline">
          Back to passphrase entry
        </Link>
      </p>
    </div>
  )
}
