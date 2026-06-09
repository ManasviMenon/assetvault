/**
 * GET /api/gdpr/export
 *
 * Returns a JSON file containing all data Virasat holds for the user's family.
 * Assets are returned as encrypted blobs — only the user can decrypt them.
 * Logs an audit event on every export.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  // Resolve family
  const { data: member } = await adminClient
    .from('members')
    .select('family_id, role')
    .eq('id', user.id)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const familyId = member.family_id

  // Assets first — needed to query documents by asset_id
  const assetsRes = await adminClient
    .from('assets')
    .select('id, type, status, encrypted_blob, est_value_bucket, created_at, updated_at')
    .eq('family_id', familyId)

  const assetIds = (assetsRes.data ?? []).map(a => a.id)

  const [
    familyRes,
    membersRes,
    documentsRes,
    remindersRes,
    auditRes,
    consentsRes,
  ] = await Promise.all([
    adminClient.from('families').select('*').eq('id', familyId).single(),
    adminClient.from('members').select('id, email, role, created_at').eq('family_id', familyId),
    assetIds.length > 0
      ? adminClient.from('documents').select('id, asset_id, r2_key, encrypted_doc_key, mime, size_bytes, sha256, created_at').in('asset_id', assetIds)
      : Promise.resolve({ data: [] }),
    adminClient.from('reminders').select('id, asset_id, type, due_date').eq('family_id', familyId),
    adminClient.from('audit_log').select('actor_id, action, target_type, target_id, ts').eq('family_id', familyId).order('ts', { ascending: false }).limit(1000),
    adminClient.from('consents').select('scope, version, granted_at, revoked_at').eq('member_id', user.id),
  ])

  // Write audit log entry for this export
  await adminClient.from('audit_log').insert({
    family_id: familyId,
    actor_id: user.id,
    action: 'export',
    target_type: 'family',
    target_id: familyId,
  })

  const payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: user.id,
    notice: 'Asset fields are client-side encrypted. Only the family key holder can decrypt them.',
    family: familyRes.data,
    members: membersRes.data ?? [],
    assets: assetsRes.data ?? [],
    documents: documentsRes.data ?? [],
    reminders: remindersRes.data ?? [],
    auditLog: auditRes.data ?? [],
    consents: consentsRes.data ?? [],
  }

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="virasat-export-${new Date().toISOString().split('T')[0]}.json"`,
    },
  })
}
