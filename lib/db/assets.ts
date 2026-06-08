/**
 * Asset data access layer.
 * All sensitive fields live in encrypted_blob — only this file encrypts/decrypts them.
 * Callers never touch raw ciphertext; they work with typed plain objects.
 * Must be called from Client Components (encryption requires the family key in memory).
 */

import { createClient } from '@/lib/supabase/client'
import { encryptRecord, decryptRecord, searchHash } from '@/lib/crypto'
import type { EncryptedRecord } from '@/lib/crypto'

// ── asset types ───────────────────────────────────────────────────────────────

export type AssetType =
  | 'bank_account'
  | 'fixed_deposit'
  | 'mutual_fund'
  | 'insurance'
  | 'property_urban'
  | 'locker'
  | 'loan_taken'
  | 'other'

export interface UniversalFields {
  physical_location?: string
  notes?: string
}

export interface BankAccountFields extends UniversalFields {
  bank: string
  branch?: string
  account_number?: string
  ifsc?: string
  account_type?: 'savings' | 'current' | 'salary' | 'nro' | 'nre'
  joint_holders?: string
}

export interface FixedDepositFields extends UniversalFields {
  bank: string
  fd_number?: string
  principal?: number
  maturity_date?: string       // ISO date string YYYY-MM-DD
  interest_rate?: number       // percentage e.g. 7.5
  auto_renew?: boolean
  certificate_location?: string
}

export interface MutualFundFields extends UniversalFields {
  amc: string
  folio_number?: string
  scheme_name?: string
  sip_amount?: number
  sip_date?: number            // day of month 1–28
}

export interface InsuranceFields extends UniversalFields {
  insurer: string
  policy_number?: string
  policy_type?: 'life' | 'health' | 'general' | 'term'
  sum_assured?: number
  premium_amount?: number
  premium_due_date?: string    // ISO date string
  riders?: string
}

export interface PropertyUrbanFields extends UniversalFields {
  address?: string
  property_type?: 'flat' | 'plot' | 'house' | 'commercial'
  area_sqft?: number
  ownership_type?: string
  society_share_cert_number?: string
  registration_number?: string
}

export interface LockerFields extends UniversalFields {
  bank: string
  branch?: string
  locker_number?: string
  key_holders?: string
  last_visited?: string        // ISO date string
}

export interface LoanTakenFields extends UniversalFields {
  lender: string
  loan_number?: string
  principal?: number
  emi_amount?: number
  emi_date?: number            // day of month 1–28
  end_date?: string            // ISO date string
  co_borrower?: string
}

export interface OtherFields extends UniversalFields {
  title: string
  description?: string
  value?: number
}

export interface AssetFieldsByType {
  bank_account: BankAccountFields
  fixed_deposit: FixedDepositFields
  mutual_fund: MutualFundFields
  insurance: InsuranceFields
  property_urban: PropertyUrbanFields
  locker: LockerFields
  loan_taken: LoanTakenFields
  other: OtherFields
}

export interface Nominee {
  memberId: string
  percentage: number | null
  isLegalHeir?: boolean
}

export interface DecryptedAsset<T extends AssetType = AssetType> {
  id: string
  type: T
  status: 'active' | 'dormant' | 'closed'
  estValueBucket: string | null
  createdAt: string
  updatedAt: string
  fields: AssetFieldsByType[T]
  nominees: Nominee[]
}

// ── value bucket helper ───────────────────────────────────────────────────────

function valueToBucket(amount: number | undefined): string | null {
  if (!amount || amount <= 0) return null
  if (amount < 100_000)   return '<1L'
  if (amount < 1_000_000) return '1L-10L'
  if (amount < 5_000_000) return '10L-50L'
  if (amount < 10_000_000) return '50L-1Cr'
  return '1Cr+'
}

function getValueAmount(type: AssetType, fields: Record<string, unknown>): number | undefined {
  switch (type) {
    case 'fixed_deposit':  return fields.principal as number | undefined
    case 'insurance':      return fields.sum_assured as number | undefined
    case 'loan_taken':     return fields.principal as number | undefined
    case 'other':          return fields.value as number | undefined
    default:               return undefined
  }
}

// ── search text helper ────────────────────────────────────────────────────────

function getSearchText(type: AssetType, fields: Record<string, unknown>): string {
  const parts: unknown[] = []
  switch (type) {
    case 'bank_account':   parts.push(fields.bank, fields.account_number, fields.account_type, fields.branch); break
    case 'fixed_deposit':  parts.push(fields.bank, fields.fd_number); break
    case 'mutual_fund':    parts.push(fields.amc, fields.scheme_name, fields.folio_number); break
    case 'insurance':      parts.push(fields.insurer, fields.policy_number, fields.policy_type); break
    case 'property_urban': parts.push(fields.address, fields.property_type); break
    case 'locker':         parts.push(fields.bank, fields.branch, fields.locker_number); break
    case 'loan_taken':     parts.push(fields.lender, fields.loan_number); break
    case 'other':          parts.push(fields.title, fields.description); break
  }
  return parts.filter(Boolean).join(' ')
}

// ── family id helper ──────────────────────────────────────────────────────────

async function getMyFamilyId(): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('members')
    .select('family_id')
    .single()
  if (error || !data) throw new Error('Could not resolve family ID')
  return data.family_id
}

// ── nominees helper ───────────────────────────────────────────────────────────

async function fetchNominees(assetId: string): Promise<Nominee[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('asset_nominees')
    .select('member_id, percentage, is_legal_heir')
    .eq('asset_id', assetId)
  return (data ?? []).map(r => ({
    memberId: r.member_id,
    percentage: r.percentage,
    isLegalHeir: r.is_legal_heir ?? false,
  }))
}

async function replaceNominees(assetId: string, nominees: Nominee[]): Promise<void> {
  const supabase = createClient()
  await supabase.from('asset_nominees').delete().eq('asset_id', assetId)
  if (nominees.length === 0) return
  await supabase.from('asset_nominees').insert(
    nominees.map(n => ({
      asset_id: assetId,
      member_id: n.memberId,
      percentage: n.percentage,
      is_legal_heir: n.isLegalHeir ?? false,
    }))
  )
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createAsset<T extends AssetType>(
  type: T,
  fields: AssetFieldsByType[T],
  familyKey: Uint8Array,
  nominees: Nominee[] = []
): Promise<string> {
  const supabase = createClient()
  const familyId = await getMyFamilyId()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const encrypted = await encryptRecord(fields, familyKey)
  const rawFields = fields as Record<string, unknown>
  const hash = await searchHash(getSearchText(type, rawFields), familyKey)
  const bucket = valueToBucket(getValueAmount(type, rawFields))

  const { data, error } = await supabase
    .from('assets')
    .insert({
      family_id: familyId,
      type,
      encrypted_blob: JSON.stringify(encrypted),
      search_hash: hash,
      est_value_bucket: bucket,
      status: 'active',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to create asset')

  if (nominees.length > 0) await replaceNominees(data.id, nominees)

  return data.id
}

export async function getAssets(familyKey: Uint8Array): Promise<DecryptedAsset[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('assets')
    .select('id, type, status, est_value_bucket, created_at, updated_at, encrypted_blob')
    .neq('status', 'closed')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  if (!data) return []

  const results: DecryptedAsset[] = []
  for (const row of data) {
    try {
      const encrypted: EncryptedRecord = JSON.parse(row.encrypted_blob)
      const fields = await decryptRecord<AssetFieldsByType[AssetType]>(encrypted, familyKey)
      const nominees = await fetchNominees(row.id)
      results.push({
        id: row.id,
        type: row.type as AssetType,
        status: row.status as DecryptedAsset['status'],
        estValueBucket: row.est_value_bucket,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        fields,
        nominees,
      })
    } catch {
      // Skip assets that fail to decrypt (wrong key, corruption)
      console.warn(`Skipping asset ${row.id}: decryption failed`)
    }
  }
  return results
}

export async function getAsset(id: string, familyKey: Uint8Array): Promise<DecryptedAsset> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('assets')
    .select('id, type, status, est_value_bucket, created_at, updated_at, encrypted_blob')
    .eq('id', id)
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Asset not found')

  const encrypted: EncryptedRecord = JSON.parse(data.encrypted_blob)
  const fields = await decryptRecord<AssetFieldsByType[AssetType]>(encrypted, familyKey)
  const nominees = await fetchNominees(id)

  return {
    id: data.id,
    type: data.type as AssetType,
    status: data.status as DecryptedAsset['status'],
    estValueBucket: data.est_value_bucket,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    fields,
    nominees,
  }
}

export async function updateAsset<T extends AssetType>(
  id: string,
  type: T,
  fields: AssetFieldsByType[T],
  familyKey: Uint8Array,
  nominees?: Nominee[]
): Promise<void> {
  const supabase = createClient()

  const encrypted = await encryptRecord(fields, familyKey)
  const rawFields = fields as Record<string, unknown>
  const hash = await searchHash(getSearchText(type, rawFields), familyKey)
  const bucket = valueToBucket(getValueAmount(type, rawFields))

  const { error } = await supabase
    .from('assets')
    .update({
      encrypted_blob: JSON.stringify(encrypted),
      search_hash: hash,
      est_value_bucket: bucket,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
  if (nominees !== undefined) await replaceNominees(id, nominees)
}

export async function softDeleteAsset(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('assets')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function searchAssets(
  query: string,
  familyKey: Uint8Array
): Promise<DecryptedAsset[]> {
  const supabase = createClient()
  const hash = await searchHash(query, familyKey)

  const { data, error } = await supabase
    .from('assets')
    .select('id, type, status, est_value_bucket, created_at, updated_at, encrypted_blob')
    .eq('search_hash', hash)
    .neq('status', 'closed')

  if (error) throw new Error(error.message)
  if (!data) return []

  const results: DecryptedAsset[] = []
  for (const row of data) {
    try {
      const encrypted: EncryptedRecord = JSON.parse(row.encrypted_blob)
      const fields = await decryptRecord<AssetFieldsByType[AssetType]>(encrypted, familyKey)
      const nominees = await fetchNominees(row.id)
      results.push({
        id: row.id,
        type: row.type as AssetType,
        status: row.status as DecryptedAsset['status'],
        estValueBucket: row.est_value_bucket,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        fields,
        nominees,
      })
    } catch {
      console.warn(`Skipping asset ${row.id}: decryption failed`)
    }
  }
  return results
}
