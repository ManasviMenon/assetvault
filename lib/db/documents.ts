/**
 * Document data access layer.
 * Each document has its own encryption key (per-doc key) wrapped with the family key.
 * The actual file bytes live in R2. This file manages the Supabase metadata side.
 * Must be called from Client Components (crypto requires the family key in memory).
 */

import { createClient } from '@/lib/supabase/client'
import { encryptRecord, decryptRecord, generateFamilyKey, toBase64, fromBase64 } from '@/lib/crypto'
import type { EncryptedRecord } from '@/lib/crypto'

export interface DocumentRecord {
  id: string
  assetId: string
  r2Key: string
  mime: string
  sizeBytes: number
  sha256: string
  createdAt: string
  // decrypted client-side:
  docKey: Uint8Array
}

export interface UploadDocumentParams {
  assetId: string
  r2Key: string
  mime: string
  sizeBytes: number
  sha256: string
  familyKey: Uint8Array
}

// ── per-doc key helpers ───────────────────────────────────────────────────────

/**
 * Generate a fresh random per-document key and wrap it with the family key.
 * Returns the raw doc key (for encrypting the file) and the wrapped version (for storage).
 */
export async function generateDocKey(familyKey: Uint8Array): Promise<{
  docKey: Uint8Array
  wrappedDocKey: string  // JSON-stringified EncryptedRecord, stored in Supabase
}> {
  const docKey = await generateFamilyKey()  // same type — 32 random bytes
  const wrapped = await encryptRecord({ key: toBase64(docKey) }, familyKey)
  return { docKey, wrappedDocKey: JSON.stringify(wrapped) }
}

/**
 * Unwrap a per-document key using the family key.
 */
export async function unwrapDocKey(
  wrappedDocKey: string,
  familyKey: Uint8Array
): Promise<Uint8Array> {
  const envelope: EncryptedRecord = JSON.parse(wrappedDocKey)
  const { key } = await decryptRecord<{ key: string }>(envelope, familyKey)
  return fromBase64(key)
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function saveDocument(
  params: UploadDocumentParams,
  wrappedDocKey: string
): Promise<string> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('documents')
    .insert({
      asset_id: params.assetId,
      r2_key: params.r2Key,
      encrypted_doc_key: wrappedDocKey,
      mime: params.mime,
      size_bytes: params.sizeBytes,
      sha256: params.sha256,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to save document')
  return data.id
}

export async function getDocumentsForAsset(
  assetId: string,
  familyKey: Uint8Array
): Promise<DocumentRecord[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('documents')
    .select('id, asset_id, r2_key, encrypted_doc_key, mime, size_bytes, sha256, created_at')
    .eq('asset_id', assetId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  if (!data) return []

  const results: DocumentRecord[] = []
  for (const row of data) {
    try {
      const docKey = await unwrapDocKey(row.encrypted_doc_key, familyKey)
      results.push({
        id: row.id,
        assetId: row.asset_id,
        r2Key: row.r2_key,
        mime: row.mime,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        createdAt: row.created_at,
        docKey,
      })
    } catch {
      console.warn(`Skipping document ${row.id}: key unwrap failed`)
    }
  }
  return results
}

export async function deleteDocument(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('documents').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function getDocumentById(
  id: string,
  familyKey: Uint8Array
): Promise<DocumentRecord> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('documents')
    .select('id, asset_id, r2_key, encrypted_doc_key, mime, size_bytes, sha256, created_at')
    .eq('id', id)
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Document not found')

  const docKey = await unwrapDocKey(data.encrypted_doc_key, familyKey)
  return {
    id: data.id,
    assetId: data.asset_id,
    r2Key: data.r2_key,
    mime: data.mime,
    sizeBytes: data.size_bytes,
    sha256: data.sha256,
    createdAt: data.created_at,
    docKey,
  }
}
