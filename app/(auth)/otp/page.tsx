'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getMemberStatus } from '@/lib/db/auth'

export default function OtpPage() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resending, setResending] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    const stored = sessionStorage.getItem('virasat_phone')
    if (!stored) { router.replace('/login'); return }
    setPhone(stored)
    inputRefs.current[0]?.focus()
  }, [router])

  function handleDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...otp]
    next[index] = digit
    setOtp(next)
    if (digit && index < 5) inputRefs.current[index + 1]?.focus()
    if (next.every(d => d) && digit) verifyOtp(next.join(''))
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  async function verifyOtp(code: string) {
    setLoading(true)
    setError('')
    const supabase = createClient()

    const { error: verifyErr } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: 'sms',
    })

    if (verifyErr) {
      setError('Incorrect code. Please try again.')
      setOtp(['', '', '', '', '', ''])
      setLoading(false)
      inputRefs.current[0]?.focus()
      return
    }

    // Check if this is a new or returning user
    const status = await getMemberStatus()
    if (status.exists) {
      router.replace('/passphrase/unlock')
    } else {
      router.replace('/passphrase/setup')
    }
  }

  async function resend() {
    setResending(true)
    const supabase = createClient()
    await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } })
    setResending(false)
    setOtp(['', '', '', '', '', ''])
    inputRefs.current[0]?.focus()
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
      <h2 className="text-xl font-semibold text-stone-900 mb-1">Enter your code</h2>
      <p className="text-stone-500 text-sm mb-6">
        Sent to {phone}
      </p>

      <div className="flex gap-2 justify-between mb-6">
        {otp.map((digit, i) => (
          <input
            key={i}
            ref={el => { inputRefs.current[i] = el }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={e => handleDigit(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            disabled={loading}
            className="w-12 h-14 text-center text-xl font-semibold text-stone-900
              border border-stone-300 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-green-700 focus:border-green-700
              disabled:opacity-50"
          />
        ))}
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {loading && (
        <p className="text-stone-500 text-sm text-center mb-4">Verifying…</p>
      )}

      <button
        onClick={resend}
        disabled={resending}
        className="w-full text-green-800 text-sm font-medium py-2 hover:underline disabled:opacity-50"
      >
        {resending ? 'Sending…' : 'Resend code'}
      </button>

      <button
        onClick={() => { sessionStorage.removeItem('virasat_phone'); router.push('/login') }}
        className="w-full text-stone-400 text-sm py-2 mt-1 hover:text-stone-600"
      >
        Use a different number
      </button>
    </div>
  )
}
