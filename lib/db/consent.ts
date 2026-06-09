import { createClient } from '@/lib/supabase/client'

export const CURRENT_CONSENT_VERSION = 'v1.0'

export type ConsentScope = 'data_processing' | 'marketing'

export interface ConsentRecord {
  id: string
  scope: ConsentScope
  version: string
  grantedAt: string
  revokedAt: string | null
}

// ── write ──────────────────────────────────────────────────────────────────────

/** Record that the current user has accepted the current consent version. */
export async function captureConsent(scope: ConsentScope): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase.from('consents').insert({
    member_id: user.id,
    scope,
    version: CURRENT_CONSENT_VERSION,
  })
  if (error) throw new Error(error.message)
}

/** Soft-revoke a consent by setting revoked_at. */
export async function revokeConsent(scope: ConsentScope): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('consents')
    .update({ revoked_at: new Date().toISOString() })
    .eq('member_id', user.id)
    .eq('scope', scope)
    .is('revoked_at', null)

  if (error) throw new Error(error.message)
}

// ── read ───────────────────────────────────────────────────────────────────────

/** Returns true if the current user has a non-revoked consent for the current version. */
export async function hasValidConsent(scope: ConsentScope): Promise<boolean> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('consents')
    .select('id')
    .eq('scope', scope)
    .eq('version', CURRENT_CONSENT_VERSION)
    .is('revoked_at', null)
    .limit(1)

  if (error) return false
  return (data?.length ?? 0) > 0
}

/** Returns the full consent history for the current user. */
export async function listConsents(): Promise<ConsentRecord[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('consents')
    .select('id, scope, version, granted_at, revoked_at')
    .order('granted_at', { ascending: false })

  if (error) throw new Error(error.message)

  return (data ?? []).map(r => ({
    id: r.id,
    scope: r.scope as ConsentScope,
    version: r.version,
    grantedAt: r.granted_at,
    revokedAt: r.revoked_at,
  }))
}
