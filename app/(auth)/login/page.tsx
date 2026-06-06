'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSend() {
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setError('Please enter a 10-digit mobile number')
      return
    }

    setLoading(true)
    setError('')

    const e164 = '+91' + digits
    const supabase = createClient()

    const { error: otpErr } = await supabase.auth.signInWithOtp({
      phone: e164,
      options: { shouldCreateUser: true },
    })

    if (otpErr) {
      setError(otpErr.message)
      setLoading(false)
      return
    }

    // Store phone for the OTP page
    sessionStorage.setItem('virasat_phone', e164)
    router.push('/otp')
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
      <h2 className="text-xl font-semibold text-stone-900 mb-1">Sign in</h2>
      <p className="text-stone-500 text-sm mb-6">
        We'll send a one-time code to your mobile number.
      </p>

      <div className="mb-4">
        <label className="block text-sm font-medium text-stone-700 mb-1">
          Mobile number
        </label>
        <div className="flex items-center border border-stone-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-green-700 focus-within:border-green-700">
          <span className="px-3 py-3 bg-stone-50 text-stone-500 text-sm border-r border-stone-300 shrink-0">
            +91
          </span>
          <input
            type="tel"
            inputMode="numeric"
            maxLength={10}
            value={phone}
            onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="98765 43210"
            className="flex-1 px-3 py-3 text-stone-900 placeholder-stone-400 text-base outline-none bg-white"
          />
        </div>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <button
        onClick={handleSend}
        disabled={loading || phone.replace(/\D/g, '').length !== 10}
        className="w-full bg-green-800 text-white rounded-lg py-3 font-medium text-base
          disabled:opacity-50 disabled:cursor-not-allowed
          hover:bg-green-900 transition-colors"
      >
        {loading ? 'Sending…' : 'Send code'}
      </button>

      <p className="text-stone-400 text-xs text-center mt-6">
        By continuing, you agree to Virasat's terms of service.
      </p>
    </div>
  )
}
