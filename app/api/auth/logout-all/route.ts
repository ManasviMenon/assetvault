/**
 * POST /api/auth/logout-all
 *
 * Signs out every active session for the current user across all devices.
 * Uses the Supabase admin API (service role) to do a global sign-out.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'

export async function POST() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { error } = await adminClient.auth.admin.signOut(user.id, 'global')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ message: 'Signed out of all devices.' })
}
