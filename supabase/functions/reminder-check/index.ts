/**
 * Supabase Edge Function — runs daily via a cron schedule.
 * Checks the reminders table for upcoming due dates and sends
 * email notifications at 60, 30, and 7 day windows.
 *
 * Deploy: supabase functions deploy reminder-check
 * Schedule: set in Supabase dashboard → Edge Functions → reminder-check → Schedule
 *           Cron: 0 6 * * *  (runs at 6am UTC daily)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

interface Reminder {
  id: string
  family_id: string
  asset_id: string | null
  type: string
  due_date: string
  notified_60: boolean
  notified_30: boolean
  notified_7: boolean
}

function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr)
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function reminderLabel(type: string): string {
  switch (type) {
    case 'fd_maturity':  return 'Fixed Deposit maturity'
    case 'premium_due':  return 'Insurance premium due'
    case 'emi':          return 'Loan EMI due'
    case 'doc_expiry':   return 'Document expiry'
    default:             return 'Financial date'
  }
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Virasat <reminders@virasat.app>',
      to,
      subject,
      html,
    }),
  })
}

async function getOwnerEmail(familyId: string): Promise<string | null> {
  const { data } = await supabase
    .from('members')
    .select('email')
    .eq('family_id', familyId)
    .in('role', ['owner', 'co_owner'])
    .not('email', 'is', null)
    .limit(1)
    .single()
  return data?.email ?? null
}

Deno.serve(async () => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Fetch all active reminders due within 65 days (generous window)
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() + 65)

  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('*')
    .gte('due_date', today.toISOString().split('T')[0])
    .lte('due_date', cutoff.toISOString().split('T')[0])

  if (error) {
    console.error('Failed to fetch reminders:', error)
    return new Response('error', { status: 500 })
  }

  let notified = 0

  for (const reminder of (reminders ?? []) as Reminder[]) {
    const days = daysUntil(reminder.due_date)
    const label = reminderLabel(reminder.type)
    const ownerEmail = await getOwnerEmail(reminder.family_id)
    if (!ownerEmail) continue

    const updates: Partial<Reminder> = {}

    if (days <= 7 && !reminder.notified_7) {
      await sendEmail(
        ownerEmail,
        `Virasat: ${label} in ${days} day${days === 1 ? '' : 's'}`,
        `<p>Your <strong>${label}</strong> is due on <strong>${reminder.due_date}</strong> — ${days} day${days === 1 ? '' : 's'} away.</p>
         <p>Open <a href="https://virasat.app">Virasat</a> to review.</p>`
      )
      updates.notified_7 = true
      notified++
    } else if (days <= 30 && !reminder.notified_30) {
      await sendEmail(
        ownerEmail,
        `Virasat: ${label} in ${days} days`,
        `<p>Your <strong>${label}</strong> is due on <strong>${reminder.due_date}</strong> — ${days} days away.</p>
         <p>Open <a href="https://virasat.app">Virasat</a> to review.</p>`
      )
      updates.notified_30 = true
      notified++
    } else if (days <= 60 && !reminder.notified_60) {
      await sendEmail(
        ownerEmail,
        `Virasat: ${label} coming up in ${days} days`,
        `<p>Heads up — your <strong>${label}</strong> is due on <strong>${reminder.due_date}</strong>.</p>
         <p>Open <a href="https://virasat.app">Virasat</a> to review.</p>`
      )
      updates.notified_60 = true
      notified++
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('reminders').update(updates).eq('id', reminder.id)
    }
  }

  console.log(`reminder-check: processed ${reminders?.length ?? 0} reminders, sent ${notified} notifications`)
  return new Response(JSON.stringify({ processed: reminders?.length ?? 0, notified }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
