import { createClient } from '@/lib/supabase/client'

export interface MemberStatus {
  exists: boolean
  pwhashSalt?: string
  publicKey?: string
  wrappedFamilyKey?: string
  recoveryEnvelope?: string | null
}

/**
 * Check if the logged-in user has completed signup and fetch their key material.
 * Called on the passphrase/unlock page to get what we need to derive the family key.
 */
export async function getMemberStatus(): Promise<MemberStatus> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { exists: false }

  const { data: member } = await supabase
    .from('members')
    .select('pwhash_salt, public_key')
    .eq('id', user.id)
    .single()

  if (!member) return { exists: false }

  const { data: keys } = await supabase
    .from('member_keys')
    .select('wrapped_family_key, recovery_envelope')
    .eq('member_id', user.id)
    .single()

  return {
    exists: true,
    pwhashSalt: member.pwhash_salt ?? undefined,
    publicKey: member.public_key ?? undefined,
    wrappedFamilyKey: keys?.wrapped_family_key ?? undefined,
    recoveryEnvelope: (keys as Record<string, unknown> | null)?.recovery_envelope as string | null ?? null,
  }
}
