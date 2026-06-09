import { createClient } from '@/lib/supabase/client'

export type AuditAction =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'export'
  | 'deletion_request'
  | 'deletion_cancel'
  | 'consent_granted'
  | 'consent_revoked'
  | 'trigger_initiated'
  | 'trigger_contested'
  | 'trigger_released'
  | 'trigger_dismissed'

export interface AuditEntry {
  id: string
  actorId: string | null
  action: AuditAction
  targetType: string | null
  targetId: string | null
  ts: string
}

// ── write ──────────────────────────────────────────────────────────────────────

/**
 * Append an entry to the audit log.
 * Runs client-side using the anon key — the INSERT RLS policy ensures
 * the entry is attributed to the current user's family only.
 */
export async function log(
  action: AuditAction,
  targetType?: string,
  targetId?: string
): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // get_my_family_id is used by RLS — we need to supply it explicitly for the insert
  const { data: member } = await supabase
    .from('members')
    .select('family_id')
    .eq('id', user.id)
    .single()

  if (!member) return

  await supabase.from('audit_log').insert({
    family_id: member.family_id,
    actor_id: user.id,
    action,
    target_type: targetType ?? null,
    target_id: targetId ?? null,
  })
}

// ── read ───────────────────────────────────────────────────────────────────────

export async function getAuditLog(
  limit = 50,
  offset = 0
): Promise<AuditEntry[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, actor_id, action, target_type, target_id, ts')
    .order('ts', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw new Error(error.message)

  return (data ?? []).map(r => ({
    id: r.id,
    actorId: r.actor_id,
    action: r.action as AuditAction,
    targetType: r.target_type,
    targetId: r.target_id,
    ts: r.ts,
  }))
}
