'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMemberStatus } from '@/lib/db/auth'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin() {
    if (!email.includes('@') || password.length < 6) {
      setError('Enter a valid email and password (min 6 chars)')
      return
    }
    setLoading(true)
    setError('')

    const supabase = createClient()

    // Try signing in first
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })

    if (signInErr) {
      // If user doesn't exist, sign them up
      if (signInErr.message.toLowerCase().includes('invalid') || signInErr.message.toLowerCase().includes('not found') || signInErr.message.toLowerCase().includes('credentials')) {
        const { error: signUpErr } = await supabase.auth.signUp({ email, password })
        if (signUpErr) {
          setError(signUpErr.message)
          setLoading(false)
          return
        }
        // Signed up → new user
        router.replace('/passphrase/setup')
        return
      }
      setError(signInErr.message)
      setLoading(false)
      return
    }

    // Signed in → check if new or returning
    const status = await getMemberStatus()
    if (status.exists) {
      router.replace('/passphrase/unlock')
    } else {
      router.replace('/passphrase/setup')
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
      <h2 className="text-xl font-semibold text-stone-900 mb-1">Sign in</h2>
      <p className="text-stone-500 text-sm mb-6">
        Enter your email and a password to access your vault.
      </p>

      <div className="space-y-4 mb-5">
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus
            className="w-full border border-stone-300 rounded-lg px-3 py-3 text-stone-900
              placeholder-stone-400 outline-none
              focus:ring-2 focus:ring-green-700 focus:border-green-700"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="At least 6 characters"
            className="w-full border border-stone-300 rounded-lg px-3 py-3 text-stone-900
              placeholder-stone-400 outline-none
              focus:ring-2 focus:ring-green-700 focus:border-green-700"
          />
        </div>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <button
        onClick={handleLogin}
        disabled={loading}
        className="w-full bg-green-800 text-white rounded-lg py-3 font-medium
          disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-900 transition-colors"
      >
        {loading ? 'Signing in…' : 'Continue'}
      </button>

      <p className="text-stone-400 text-xs text-center mt-6">
        First time? Just enter your email and pick a password — we'll create your account.
      </p>

      {/* DEV ONLY: email+password auth. Swap to phone OTP before beta. */}
    </div>
  )
}
