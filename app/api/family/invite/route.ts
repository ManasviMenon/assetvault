import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'
import type { MemberRole } from '@/lib/supabase/types'

const ALLOWED_ROLES: MemberRole[] = ['co_owner', 'trusted_contact', 'heir']

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only owners and co-owners can invite
  const { data: me } = await supabase
    .from('members')
    .select('role, family_id')
    .eq('id', user.id)
    .single()

  if (!me || !['owner', 'co_owner'].includes(me.role)) {
    return NextResponse.json({ error: 'Only owners can invite members' }, { status: 403 })
  }

  const { email, role } = await request.json() as { email: string; role: MemberRole }

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  // Check family member limit (free plan: 1 member, family plan: 6)
  const { count } = await adminClient
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('family_id', me.family_id)

  const { data: sub } = await adminClient
    .from('subscriptions')
    .select('plan')
    .eq('family_id', me.family_id)
    .single()

  const limit = sub?.plan === 'family' ? 6 : 1
  if ((count ?? 0) >= limit) {
    return NextResponse.json(
      { error: sub?.plan === 'family' ? 'Family member limit (6) reached' : 'Upgrade to Family plan to add members' },
      { status: 403 }
    )
  }

  // Check not already a member or pending invite
  const { data: existing } = await adminClient
    .from('members')
    .select('id')
    .eq('family_id', me.family_id)
    .eq('email', email)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'This person is already a member' }, { status: 409 })
  }

  // Create invitation record
  const { data: invite, error: inviteErr } = await adminClient
    .from('invitations')
    .insert({
      family_id: me.family_id,
      email,
      role,
      created_by: user.id,
    })
    .select('token')
    .single()

  if (inviteErr || !invite) {
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }

  // Send invite email via Resend
  // TODO: wire up Resend when RESEND_API_KEY is configured
  // For now, return the invite token so it can be shared manually during beta
  const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/join?token=${invite.token}`

  if (process.env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Virasat <noreply@virasat.app>',
          to: email,
          subject: 'You have been invited to a Virasat family vault',
          html: `
            <p>You have been invited to join a family vault on Virasat.</p>
            <p>Click the link below to accept the invitation and set up your access:</p>
            <p><a href="${inviteLink}">${inviteLink}</a></p>
            <p>This link expires in 7 days.</p>
          `,
        }),
      })
    } catch {
      // Email failure is non-fatal — token is returned so invite can be shared manually
    }
  }

  // Audit log
  await adminClient.from('audit_log').insert({
    family_id: me.family_id,
    actor_id: user.id,
    action: 'create',
    target_type: 'invitation',
    target_id: null,
  })

  return NextResponse.json({ ok: true, inviteLink })
}
