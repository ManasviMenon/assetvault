import { NextRequest, NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@/lib/supabase/server'
import { r2, R2_BUCKET } from '@/lib/r2/client'
import { randomUUID } from 'crypto'

// Allowed MIME types for document uploads
const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]

// 20 MB max per file
const MAX_SIZE_BYTES = 20 * 1024 * 1024

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch this user's family_id to namespace the R2 key
  const { data: member } = await supabase
    .from('members')
    .select('family_id')
    .eq('id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 403 })

  const { mime, sizeBytes, assetId } = await request.json() as {
    mime: string
    sizeBytes: number
    assetId: string
  }

  if (!ALLOWED_MIME.includes(mime)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }
  if (sizeBytes > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'File too large (max 20 MB)' }, { status: 400 })
  }

  // R2 key: families/<family_id>/docs/<uuid> — namespaced so RLS-equivalent applies at storage level
  const fileId = randomUUID()
  const r2Key = `families/${member.family_id}/docs/${fileId}`

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
    ContentType: mime,
    ContentLength: sizeBytes,
  })

  // Pre-signed URL valid for 10 minutes — enough time to encrypt + upload on a slow connection
  const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 600 })

  return NextResponse.json({ uploadUrl, r2Key })
}
