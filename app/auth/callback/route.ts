import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Handles the magic link redirect from Supabase email
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        // Check if this user has already completed setup
        const { data: member } = await supabase
          .from('members')
          .select('id')
          .eq('id', user.id)
          .single()

        if (member) {
          return NextResponse.redirect(new URL('/passphrase/unlock', origin))
        } else {
          return NextResponse.redirect(new URL('/passphrase/setup', origin))
        }
      }
    }
  }

  return NextResponse.redirect(new URL('/login?error=auth_failed', origin))
}
