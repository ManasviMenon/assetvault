import { NextRequest, NextResponse } from 'next/server'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@/lib/supabase/server'
import { r2, R2_BUCKET } from '@/lib/r2/client'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { documentId } = await request.json() as { documentId: string }

  // Fetch r2_key and verify ownership via RLS before deleting
  const { data: doc, error } = await supabase
    .from('documents')
    .select('r2_key')
    .eq('id', documentId)
    .single()

  if (error || !doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Delete from R2 first, then from Supabase
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2_key }))

  await supabase.from('documents').delete().eq('id', documentId)

  return NextResponse.json({ ok: true })
}
