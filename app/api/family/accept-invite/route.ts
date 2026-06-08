import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'

interface AcceptInviteBody {
  token: string
  publicKey: string
  pwhashSalt: string
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check user doesn't already have a member row
  const { data: existing } = await adminClient
    .from('members')
    .select('id')
    .eq('id', user.id)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'Already a member' }, { status: 409 })
  }

  const { token, publicKey, pwhashSalt } = await request.json() as AcceptInviteBody

  if (!token || !publicKey || !pwhashSalt) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Look up the invitation
  const { data: invite, error: inviteErr } = await adminClient
    .from('invitations')
    .select('id, family_id, role, email, expires_at, accepted_at')
    .eq('token', token)
    .single()

  if (inviteErr || !invite) {
    return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 404 })
  }

  if (invite.accepted_at) {
    return NextResponse.json({ error: 'Invitation already used' }, { status: 409 })
  }

  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 })
  }

  // Verify email matches (Supabase auth email must match the invite email)
  if (user.email && invite.email && user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json(
      { error: 'Please sign in with the email address the invitation was sent to' },
      { status: 403 }
    )
  }

  // Create the member row in the existing family
  const { error: memberErr } = await adminClient
    .from('members')
    .insert({
      id: user.id,
      family_id: invite.family_id,
      email: user.email ?? null,
      phone_e164: user.phone ?? null,
      role: invite.role,
      public_key: publicKey,
      pwhash_salt: pwhashSalt,
    })

  if (memberErr) {
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 })
  }

  // Mark invitation as accepted
  await adminClient
    .from('invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  // DPDPA consent
  await adminClient
    .from('consents')
    .insert({ member_id: user.id, scope: 'data_processing', version: '1.0' })

  // Audit log
  await adminClient.from('audit_log').insert({
    family_id: invite.family_id,
    actor_id: user.id,
    action: 'create',
    target_type: 'member',
    target_id: user.id,
  })

  // Note: member_keys row is NOT created here.
  // The owner's browser must wrap the family key for this member and POST to /api/family/wrap-key.
  // Until then, this member can log in but won't have vault access (KeyGuard will redirect them).

  return NextResponse.json({ familyId: invite.family_id })
}
