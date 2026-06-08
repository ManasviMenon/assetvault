/**
 * Reminder detection logic.
 * Runs client-side after assets are decrypted.
 * Extracts upcoming dates from each asset and writes them to the reminders table.
 * The reminders table stores only { type, due_date } — no sensitive fields.
 */

import { createClient } from '@/lib/supabase/client'
import type { DecryptedAsset, AssetType } from '@/lib/db/assets'
import type { ReminderType } from '@/lib/supabase/types'

export interface ReminderCandidate {
  assetId: string
  type: ReminderType
  dueDate: string  // ISO date YYYY-MM-DD
}

// ── extract dates from decrypted asset fields ─────────────────────────────────

function extractDates(asset: DecryptedAsset): ReminderCandidate[] {
  const f = asset.fields as Record<string, unknown>
  const candidates: ReminderCandidate[] = []

  switch (asset.type as AssetType) {
    case 'fixed_deposit': {
      if (f.maturity_date && typeof f.maturity_date === 'string') {
        candidates.push({
          assetId: asset.id,
          type: 'fd_maturity',
          dueDate: f.maturity_date,
        })
      }
      break
    }

    case 'insurance': {
      if (f.premium_due_date && typeof f.premium_due_date === 'string') {
        candidates.push({
          assetId: asset.id,
          type: 'premium_due',
          dueDate: f.premium_due_date,
        })
      }
      break
    }

    case 'loan_taken': {
      // EMI is recurring — next due date is the next occurrence of emi_date day of month
      if (f.emi_date && typeof f.emi_date === 'number') {
        const nextEmi = nextOccurrenceOfDay(f.emi_date)
        candidates.push({
          assetId: asset.id,
          type: 'emi',
          dueDate: nextEmi,
        })
      }
      break
    }
  }

  return candidates
}

/**
 * Given a day of month (1–28), returns the next upcoming date with that day.
 * e.g. day=5 → next 5th of the month as YYYY-MM-DD
 */
function nextOccurrenceOfDay(day: number): string {
  const today = new Date()
  const candidate = new Date(today.getFullYear(), today.getMonth(), day)
  if (candidate <= today) {
    candidate.setMonth(candidate.getMonth() + 1)
  }
  return candidate.toISOString().split('T')[0]
}

// ── sync reminders to Supabase ─────────────────────────────────────────────────

/**
 * Call this after decrypting assets on the home or calendar screen.
 * Upserts the reminders table so it reflects the current state of assets.
 * Existing reminders for closed assets are removed.
 */
export async function syncReminders(
  assets: DecryptedAsset[],
  familyId: string
): Promise<void> {
  const supabase = createClient()

  const activeAssets = assets.filter(a => a.status === 'active')
  const candidates = activeAssets.flatMap(extractDates)

  if (candidates.length === 0) {
    // Remove all reminders for this family if no dates found
    await supabase.from('reminders').delete().eq('family_id', familyId)
    return
  }

  // Upsert all current reminders
  const rows = candidates.map(c => ({
    family_id: familyId,
    asset_id: c.assetId,
    type: c.type,
    due_date: c.dueDate,
    notified_60: false,
    notified_30: false,
    notified_7: false,
  }))

  await supabase
    .from('reminders')
    .upsert(rows, { onConflict: 'asset_id,type' })

  // Remove reminders for assets that no longer exist or are closed
  const activeAssetIds = new Set(activeAssets.map(a => a.id))
  const { data: existing } = await supabase
    .from('reminders')
    .select('id, asset_id')
    .eq('family_id', familyId)

  const staleIds = (existing ?? [])
    .filter(r => r.asset_id && !activeAssetIds.has(r.asset_id))
    .map(r => r.id)

  if (staleIds.length > 0) {
    await supabase.from('reminders').delete().in('id', staleIds)
  }
}

// ── read reminders for display ─────────────────────────────────────────────────

export interface UpcomingReminder {
  id: string
  assetId: string
  type: ReminderType
  dueDate: string
  daysUntil: number
}

export async function getUpcomingReminders(
  familyId: string,
  withinDays = 90
): Promise<UpcomingReminder[]> {
  const supabase = createClient()
  const today = new Date()
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() + withinDays)

  const { data, error } = await supabase
    .from('reminders')
    .select('id, asset_id, type, due_date')
    .eq('family_id', familyId)
    .gte('due_date', today.toISOString().split('T')[0])
    .lte('due_date', cutoff.toISOString().split('T')[0])
    .order('due_date', { ascending: true })

  if (error) throw new Error(error.message)

  return (data ?? []).map(r => {
    const due = new Date(r.due_date)
    const daysUntil = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return {
      id: r.id,
      assetId: r.asset_id ?? '',
      type: r.type,
      dueDate: r.due_date,
      daysUntil,
    }
  })
}
