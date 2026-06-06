'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCrypto } from '@/contexts/CryptoContext'
import {
  generatePwhashSalt,
  deriveMasterKey,
  deriveKeypairFromMasterKey,
  generateFamilyKey,
  wrapKeyForMember,
  generateBackupPhrase,
  createSealedRecoveryEnvelope,
  toBase64,
} from '@/lib/crypto'

type Step = 'passphrase' | 'backup' | 'confirm'

export default function PassphraseSetupPage() {
  const router = useRouter()
  const { setFamilyKey } = useCrypto()

  const [step, setStep] = useState<Step>('passphrase')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Generated in step 1, shown in step 2
  const [backupPhrase, setBackupPhrase] = useState('')
  const [pendingFamilyKey, setPendingFamilyKey] = useState<Uint8Array | null>(null)
  const [pendingPayload, setPendingPayload] = useState<object | null>(null)

  // Backup phrase confirmation
  const [confirmed, setConfirmed] = useState(false)
  const [finalising, setFinalising] = useState(false)

  async function handleSetPassphrase() {
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters')
      return
    }
    if (passphrase !== confirm) {
      setError('Passphrases do not match')
      return
    }
    if (!consent) {
      setError('Please accept the data processing terms to continue')
      return
    }

    setLoading(true)
    setError('')

    try {
      const salt = await generatePwhashSalt()
      const masterKey = await deriveMasterKey(passphrase, salt)
      const { publicKey, privateKey } = await deriveKeypairFromMasterKey(masterKey)
      const familyKey = await generateFamilyKey()
      const wrappedFamilyKey = await wrapKeyForMember(familyKey, publicKey)
      const { phrase, recoveryKey } = await generateBackupPhrase()
      const recoveryEnvelope = await createSealedRecoveryEnvelope(familyKey, recoveryKey)

      setPendingFamilyKey(familyKey)
      setBackupPhrase(phrase)
      setPendingPayload({
        publicKey,
        pwhashSalt: toBase64(salt),
        wrappedFamilyKey,
        recoveryEnvelope: JSON.stringify(recoveryEnvelope),
      })

      setStep('backup')
    } catch (e) {
      setError('Something went wrong. Please try again.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleFinish() {
    if (!confirmed) {
      setError('Please confirm you have saved your backup phrase')
      return
    }
    setFinalising(true)
    setError('')

    try {
      const res = await fetch('/api/auth/complete-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingPayload),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Signup failed. Please try again.')
        setFinalising(false)
        return
      }

      if (pendingFamilyKey) setFamilyKey(pendingFamilyKey)
      router.replace('/home')
    } catch {
      setError('Network error. Please try again.')
      setFinalising(false)
    }
  }

  if (step === 'passphrase') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
        <h2 className="text-xl font-semibold text-stone-900 mb-1">Set your passphrase</h2>
        <p className="text-stone-500 text-sm mb-6">
          This is the key to your family's vault. Choose something you'll remember —
          you'll need it every time you open Virasat.
        </p>

        <div className="space-y-4 mb-5">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Passphrase</label>
            <input
              type="password"
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full border border-stone-300 rounded-lg px-3 py-3 text-stone-900
                focus:outline-none focus:ring-2 focus:ring-green-700 focus:border-green-700"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Confirm passphrase</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Same passphrase again"
              className="w-full border border-stone-300 rounded-lg px-3 py-3 text-stone-900
                focus:outline-none focus:ring-2 focus:ring-green-700 focus:border-green-700"
            />
          </div>
        </div>

        <label className="flex items-start gap-3 mb-5 cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={e => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 text-green-800 rounded border-stone-300"
          />
          <span className="text-sm text-stone-600">
            I agree to Virasat processing my financial data for the purpose of family asset management
            and protection. I understand I can export or delete my data at any time.
          </span>
        </label>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <button
          onClick={handleSetPassphrase}
          disabled={loading}
          className="w-full bg-green-800 text-white rounded-lg py-3 font-medium
            disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-900 transition-colors"
        >
          {loading ? 'Setting up your vault…' : 'Continue'}
        </button>
      </div>
    )
  }

  if (step === 'backup') {
    const words = backupPhrase.split(' ')
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
        <h2 className="text-xl font-semibold text-stone-900 mb-1">Save your backup phrase</h2>
        <p className="text-stone-500 text-sm mb-5">
          If you forget your passphrase, these 24 words are your only way back in.
          Write them down on paper and store them somewhere safe. We cannot recover them for you.
        </p>

        <div className="bg-stone-50 rounded-xl p-4 mb-5">
          <div className="grid grid-cols-3 gap-2">
            {words.map((word, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="text-stone-400 text-xs w-5 text-right shrink-0">{i + 1}.</span>
                <span className="text-stone-800 text-sm font-medium">{word}</span>
              </div>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-3 mb-5 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 text-green-800 rounded border-stone-300"
          />
          <span className="text-sm text-stone-600">
            I have written down all 24 words in the correct order and stored them safely.
          </span>
        </label>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <button
          onClick={handleFinish}
          disabled={finalising || !confirmed}
          className="w-full bg-green-800 text-white rounded-lg py-3 font-medium
            disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-900 transition-colors"
        >
          {finalising ? 'Opening your vault…' : 'I've saved my phrase — open vault'}
        </button>
      </div>
    )
  }

  return null
}
