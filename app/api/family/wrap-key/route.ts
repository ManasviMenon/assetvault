import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'

// Owner's browser calls this after wrapping the family key for a new member.
// The raw family key never leaves the browser — only the wrapped (encrypted) version is sent here.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only owners and co-owners can distribute the family key
  const { data: me } = await supabase
    .from('members')
    .select('role, family_id')
    .eq('id', user.id)
    .single()

  if (!me || !['owner', 'co_owner'].includes(me.role)) {
    return NextResponse.json({ error: 'Only owners can distribute vault access' }, { status: 403 })
  }

  const { memberId, wrappedFamilyKey } = await request.json() as {
    memberId: string
    wrappedFamilyKey: string
  }

  if (!memberId || !wrappedFamilyKey) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Verify the target member belongs to the same family
  const { data: targetMember } = await adminClient
    .from('members')
    .select('id, family_id')
    .eq('id', memberId)
    .eq('family_id', me.family_id)
    .single()

  if (!targetMember) {
    return NextResponse.json({ error: 'Member not found in your family' }, { status: 404 })
  }

  // Upsert the wrapped key
  const { error } = await adminClient
    .from('member_keys')
    .upsert({
      member_id: memberId,
      wrapped_family_key: wrappedFamilyKey,
      recovery_method: 'owner_wrap',
    })

  if (error) {
    return NextResponse.json({ error: 'Failed to save key' }, { status: 500 })
  }

  await adminClient.from('audit_log').insert({
    family_id: me.family_id,
    actor_id: user.id,
    action: 'create',
    target_type: 'member_key',
    target_id: memberId,
  })

  return NextResponse.json({ ok: true })
}
