import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

/**
 * Admin Supabase client — uses the service role key, bypasses RLS.
 *
 * ONLY import this in server-side code (route handlers, Edge Functions).
 * NEVER import it in 'use client' components or any file that ships to the browser.
 * The service role key must never reach the browser.
 */
export const adminClient = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
