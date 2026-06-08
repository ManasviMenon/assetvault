/**
 * Family member data access layer.
 * Handles member listing, role management, and the key-wrapping flow
 * that gives new members access to the family vault.
 */

import { createClient } from '@/lib/supabase/client'
import type { MemberRole } from '@/lib/supabase/types'
import { wrapKeyForMember } from '@/lib/crypto'

export type { MemberRole }

export interface FamilyMember {
  id: string
  email: string | null
  phone: string | null
  role: MemberRole
  publicKey: string | null
  createdAt: string
  hasVaultAccess: boolean   // true if member_keys row exists for them
}

// ── read ──────────────────────────────────────────────────────────────────────

export async function getFamilyMembers(): Promise<FamilyMember[]> {
  const supabase = createClient()

  const { data: members, error } = await supabase
    .from('members')
    .select('id, email, phone_e164, role, public_key, created_at')
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  if (!members) return []

  // Check which members have a wrapped family key (vault access)
  const { data: keys } = await supabase
    .from('member_keys')
    .select('member_id')

  const membersWithKeys = new Set((keys ?? []).map(k => k.member_id))

  return members.map(m => ({
    id: m.id,
    email: m.email,
    phone: m.phone_e164,
    role: m.role,
    publicKey: m.public_key,
    createdAt: m.created_at,
    hasVaultAccess: membersWithKeys.has(m.id),
  }))
}

/**
 * Returns members who have completed passphrase setup (have a public_key)
 * but don't have a wrapped family key yet — owner needs to wrap one for them.
 */
export async function getMembersAwaitingKeyWrap(): Promise<{ id: string; publicKey: string }[]> {
  const supabase = createClient()

  const { data: members } = await supabase
    .from('members')
    .select('id, public_key')
    .not('public_key', 'is', null)

  if (!members) return []

  const { data: keys } = await supabase
    .from('member_keys')
    .select('member_id')

  const membersWithKeys = new Set((keys ?? []).map(k => k.member_id))

  return members
    .filter(m => m.public_key && !membersWithKeys.has(m.id))
    .map(m => ({ id: m.id, publicKey: m.public_key! }))
}

// ── write ─────────────────────────────────────────────────────────────────────

export async function updateMemberRole(memberId: string, role: MemberRole): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('members')
    .update({ role })
    .eq('id', memberId)
  if (error) throw new Error(error.message)
}

export async function removeMember(memberId: string): Promise<void> {
  const supabase = createClient()
  // Delete member_keys first (FK), then the member row
  await supabase.from('member_keys').delete().eq('member_id', memberId)
  const { error } = await supabase.from('members').delete().eq('id', memberId)
  if (error) throw new Error(error.message)
}

/**
 * Owner's browser calls this after wrapping the family key for a new member.
 * The wrapped key is stored server-side; the raw family key never leaves the browser.
 */
export async function saveWrappedKeyForMember(
  memberId: string,
  wrappedFamilyKey: string
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('member_keys')
    .upsert({
      member_id: memberId,
      wrapped_family_key: wrappedFamilyKey,
      recovery_method: 'owner_wrap',
    })
  if (error) throw new Error(error.message)
}

/**
 * Convenience: wrap the family key for a member and save it in one call.
 * Called from the UI after owner sees a "pending" member.
 */
export async function wrapAndSaveFamilyKey(
  memberId: string,
  memberPublicKey: string,
  familyKey: Uint8Array
): Promise<void> {
  const wrappedFamilyKey = await wrapKeyForMember(familyKey, memberPublicKey)
  await saveWrappedKeyForMember(memberId, JSON.stringify(wrappedFamilyKey))
}
