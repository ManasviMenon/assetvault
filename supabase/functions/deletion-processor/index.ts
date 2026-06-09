/**
 * Supabase Edge Function — runs daily via cron.
 * Finds families whose 7-day deletion window has passed and:
 *   1. Deletes all their files from R2
 *   2. Deletes all Supabase rows (cascades from families table)
 *   3. Deletes the Supabase auth users for all members
 *
 * Deploy: supabase functions deploy deletion-processor
 * Schedule: 0 3 * * *  (3am UTC daily)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID')!
const R2_ACCESS_KEY = Deno.env.get('R2_ACCESS_KEY_ID')!
const R2_SECRET_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY')!
const R2_BUCKET     = Deno.env.get('R2_BUCKET_NAME') ?? 'virasatdocs'

// ── minimal AWS SigV4 for R2 delete ──────────────────────────────────────────

async function hmacSha256(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function deleteFromR2(r2Key: string): Promise<void> {
  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const now = new Date()
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const dateStamp = amzDate.slice(0, 8)
  const region = 'auto'
  const service = 's3'

  const payloadHash = await sha256Hex('')
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = `DELETE\n/${r2Key}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`

  const enc = new TextEncoder()
  const kDate    = await hmacSha256(enc.encode(`AWS4${R2_SECRET_KEY}`), dateStamp)
  const kRegion  = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  const kSigning = await hmacSha256(kService, 'aws4_request')
  const signature = toHex(await hmacSha256(kSigning, stringToSign))

  const authorization = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  await fetch(`${endpoint}/${R2_BUCKET}/${r2Key}`, {
    method: 'DELETE',
    headers: {
      'Host': host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      'Authorization': authorization,
    },
  })
}

// ── main ──────────────────────────────────────────────────────────────────────

Deno.serve(async () => {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Families where deletion was requested > 7 days ago and not cancelled after the request
  const { data: families, error } = await supabase
    .from('families')
    .select('id, deletion_requested_at, deletion_cancelled_at')
    .not('deletion_requested_at', 'is', null)
    .lte('deletion_requested_at', cutoff)

  if (error) {
    console.error('Failed to query families:', error)
    return new Response('error', { status: 500 })
  }

  // Filter out families where deletion was cancelled after the request
  const toDo = (families ?? []).filter(f => {
    if (!f.deletion_cancelled_at) return true
    return new Date(f.deletion_cancelled_at) < new Date(f.deletion_requested_at!)
  })

  let processed = 0

  for (const family of toDo) {
    console.log(`Processing deletion for family ${family.id}`)

    // 1. Fetch all R2 keys for this family's documents
    const { data: assets } = await supabase
      .from('assets')
      .select('id')
      .eq('family_id', family.id)

    const assetIds = (assets ?? []).map(a => a.id)

    if (assetIds.length > 0) {
      const { data: docs } = await supabase
        .from('documents')
        .select('r2_key')
        .in('asset_id', assetIds)

      // 2. Delete all R2 files
      for (const doc of docs ?? []) {
        try {
          await deleteFromR2(doc.r2_key)
        } catch (e) {
          console.warn(`Failed to delete R2 object ${doc.r2_key}:`, e)
        }
      }
    }

    // 3. Collect member auth user IDs before deleting rows
    const { data: memberRows } = await supabase
      .from('members')
      .select('id')
      .eq('family_id', family.id)

    const memberIds = (memberRows ?? []).map(m => m.id)

    // 4. Delete family row — cascades to members, assets, documents, reminders, triggers, audit_log, consents, subscriptions
    await supabase.from('families').delete().eq('id', family.id)

    // 5. Delete Supabase auth users (after DB rows are gone)
    for (const memberId of memberIds) {
      try {
        await supabase.auth.admin.deleteUser(memberId)
      } catch (e) {
        console.warn(`Failed to delete auth user ${memberId}:`, e)
      }
    }

    processed++
    console.log(`Deleted family ${family.id} (${memberIds.length} members, ${assetIds.length} assets)`)
  }

  return new Response(
    JSON.stringify({ checked: toDo.length, processed }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
