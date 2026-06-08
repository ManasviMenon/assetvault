'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMemberStatus } from '@/lib/db/auth'

function passwordStrength(p: string): { label: string; color: string; width: string } {
  if (p.length === 0) return { label: '', color: '', width: '0%' }
  let score = 0
  if (p.length >= 6) score++
  if (p.length >= 10) score++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++
  if (/[0-9]/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  if (score <= 1) return { label: 'Weak', color: 'bg-red-400', width: '20%' }
  if (score === 2) return { label: 'Fair', color: 'bg-amber-400', width: '45%' }
  if (score === 3) return { label: 'Good', color: 'bg-yellow-400', width: '65%' }
  if (score === 4) return { label: 'Strong', color: 'bg-green-500', width: '85%' }
  return { label: 'Very strong', color: 'bg-green-700', width: '100%' }
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  async function handleLogin() {
    if (!email.includes('@') || password.length < 6) {
      setError('Enter a valid email and password (min 6 chars)')
      return
    }
    setLoading(true)
    setError('')

    const supabase = createClient()

    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })

    if (signInErr) {
      if (signInErr.message.toLowerCase().includes('invalid') || signInErr.message.toLowerCase().includes('not found') || signInErr.message.toLowerCase().includes('credentials')) {
        const { error: signUpErr } = await supabase.auth.signUp({ email, password })
        if (signUpErr) {
          setError(signUpErr.message)
          setLoading(false)
          return
        }
        router.replace('/passphrase/setup')
        return
      }
      setError(signInErr.message)
      setLoading(false)
      return
    }

    const status = await getMemberStatus()
    if (status.exists) {
      router.replace('/passphrase/unlock')
    } else {
      router.replace('/passphrase/setup')
    }
  }

  const strength = passwordStrength(password)

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
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="At least 6 characters"
              className="w-full border border-stone-300 rounded-lg px-3 py-3 pr-10 text-stone-900
                placeholder-stone-400 outline-none
                focus:ring-2 focus:ring-green-700 focus:border-green-700"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
              tabIndex={-1}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
          {password && (
            <div className="mt-2">
              <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${strength.color}`}
                  style={{ width: strength.width }}
                />
              </div>
              <p className="text-xs mt-1 text-stone-500">{strength.label}</p>
            </div>
          )}
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
