import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'

interface SignupBody {
  publicKey: string
  pwhashSalt: string
  wrappedFamilyKey: string
  recoveryEnvelope: string
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Prevent double-signup
  const { data: existing } = await adminClient
    .from('members')
    .select('id')
    .eq('id', user.id)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'Already signed up' }, { status: 409 })
  }

  const body: SignupBody = await request.json()
  const { publicKey, pwhashSalt, wrappedFamilyKey, recoveryEnvelope } = body

  if (!publicKey || !pwhashSalt || !wrappedFamilyKey || !recoveryEnvelope) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Create family
  const { data: family, error: familyErr } = await adminClient
    .from('families')
    .insert({ plan_tier: 'free', dpdp_consent_version: '1.0' })
    .select('id')
    .single()

  if (familyErr || !family) {
    return NextResponse.json({ error: 'Failed to create family' }, { status: 500 })
  }

  // Create member row — use email for email-based auth, phone for phone-based auth
  const { error: memberErr } = await adminClient
    .from('members')
    .insert({
      id: user.id,
      family_id: family.id,
      phone_e164: user.phone ?? null,
      email: user.email ?? null,
      role: 'owner',
      public_key: publicKey,
      pwhash_salt: pwhashSalt,
    })

  if (memberErr) {
    await adminClient.from('families').delete().eq('id', family.id)
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 })
  }

  // Create member_keys row
  const { error: keysErr } = await adminClient
    .from('member_keys')
    .insert({
      member_id: user.id,
      wrapped_family_key: wrappedFamilyKey,
      recovery_method: 'backup_phrase',
      recovery_envelope: recoveryEnvelope,
    })

  if (keysErr) {
    await adminClient.from('members').delete().eq('id', user.id)
    await adminClient.from('families').delete().eq('id', family.id)
    return NextResponse.json({ error: 'Failed to create keys' }, { status: 500 })
  }

  // Create free subscription
  await adminClient
    .from('subscriptions')
    .insert({ family_id: family.id, plan: 'free', status: 'active' })

  // Create DPDPA consent record
  await adminClient
    .from('consents')
    .insert({ member_id: user.id, scope: 'data_processing', version: '1.0' })

  // Audit log
  await adminClient.from('audit_log').insert({
    family_id: family.id,
    actor_id: user.id,
    action: 'create',
    target_type: 'family',
    target_id: family.id,
  })

  return NextResponse.json({ familyId: family.id })
}
