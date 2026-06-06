'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSend() {
    if (!email.includes('@')) {
      setError('Please enter a valid email address')
      return
    }

    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })

    if (otpErr) {
      setError(otpErr.message)
      setLoading(false)
      return
    }

    sessionStorage.setItem('virasat_email', email)
    setSent(true)
    setLoading(false)
    router.push('/otp')
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
      <h2 className="text-xl font-semibold text-stone-900 mb-1">Sign in</h2>
      <p className="text-stone-500 text-sm mb-6">
        We'll send a one-time code to your email address.
      </p>

      <div className="mb-4">
        <label className="block text-sm font-medium text-stone-700 mb-1">
          Email address
        </label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="you@example.com"
          autoFocus
          className="w-full border border-stone-300 rounded-lg px-3 py-3 text-stone-900
            placeholder-stone-400 text-base outline-none
            focus:ring-2 focus:ring-green-700 focus:border-green-700"
        />
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <button
        onClick={handleSend}
        disabled={loading || !email.includes('@')}
        className="w-full bg-green-800 text-white rounded-lg py-3 font-medium text-base
          disabled:opacity-50 disabled:cursor-not-allowed
          hover:bg-green-900 transition-colors"
      >
        {loading ? 'Sending…' : 'Send code'}
      </button>

      <p className="text-stone-400 text-xs text-center mt-6">
        By continuing, you agree to Virasat's terms of service.
      </p>

      {/* DEV NOTE: using email OTP during development — swap to phone + MSG91 before beta */}
    </div>
  )
}
