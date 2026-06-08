import { NextRequest, NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@/lib/supabase/server'
import { r2, R2_BUCKET } from '@/lib/r2/client'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { documentId } = await request.json() as { documentId: string }

  // Fetch the document and verify it belongs to this user's family (RLS handles this)
  const { data: doc, error } = await supabase
    .from('documents')
    .select('r2_key, asset_id')
    .eq('id', documentId)
    .single()

  if (error || !doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: doc.r2_key,
  })

  // Short-lived URL — 1 hour is plenty to decrypt and display
  const downloadUrl = await getSignedUrl(r2, command, { expiresIn: 3600 })

  return NextResponse.json({ downloadUrl })
}
