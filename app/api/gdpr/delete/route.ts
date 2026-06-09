/**
 * POST /api/gdpr/delete   — request account deletion (7-day cancellation window)
 * DELETE /api/gdpr/delete — cancel a pending deletion request
 *
 * Only the family owner can request deletion.
 * Deletion is processed by the deletion-processor Edge Function after 7 days.
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

  const { data: member } = await adminClient
    .from('members')
    .select('family_id, role')
    .eq('id', user.id)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  if (member.role !== 'owner') {
    return NextResponse.json({ error: 'Only the family owner can request deletion' }, { status: 403 })
  }

  const requestedAt = new Date().toISOString()
  const deletionDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await adminClient
    .from('families')
    .update({
      deletion_requested_at: requestedAt,
      deletion_cancelled_at: null,
    })
    .eq('id', member.family_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await adminClient.from('audit_log').insert({
    family_id: member.family_id,
    actor_id: user.id,
    action: 'deletion_request',
    target_type: 'family',
    target_id: member.family_id,
  })

  return NextResponse.json({
    message: 'Deletion scheduled. You have 7 days to cancel.',
    deletionDue,
  })
}

export async function DELETE() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { data: member } = await adminClient
    .from('members')
    .select('family_id, role')
    .eq('id', user.id)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  if (member.role !== 'owner') {
    return NextResponse.json({ error: 'Only the family owner can cancel deletion' }, { status: 403 })
  }

  const { data: family } = await adminClient
    .from('families')
    .select('deletion_requested_at')
    .eq('id', member.family_id)
    .single()

  if (!family?.deletion_requested_at) {
    return NextResponse.json({ error: 'No pending deletion request' }, { status: 400 })
  }

  // Check the 7-day window hasn't already passed
  const requestedAt = new Date(family.deletion_requested_at)
  const deadline = new Date(requestedAt.getTime() + 7 * 24 * 60 * 60 * 1000)
  if (new Date() > deadline) {
    return NextResponse.json({ error: 'Cancellation window has passed' }, { status: 400 })
  }

  await adminClient
    .from('families')
    .update({ deletion_cancelled_at: new Date().toISOString() })
    .eq('id', member.family_id)

  await adminClient.from('audit_log').insert({
    family_id: member.family_id,
    actor_id: user.id,
    action: 'deletion_cancel',
    target_type: 'family',
    target_id: member.family_id,
  })

  return NextResponse.json({ message: 'Deletion cancelled. Your data is safe.' })
}
