/**
 * Family financial health score (0–100).
 * Measures organisational, protective, and structural health.
 * NEVER investment performance. NEVER advice.
 *
 * Runs client-side — takes already-decrypted assets and family data as input.
 * Called from the home screen after assets and members are loaded.
 */

import type { DecryptedAsset } from '@/lib/db/assets'
import type { FamilyMember } from '@/lib/db/members'
import type { UpcomingReminder } from '@/lib/reminders/detect'

export interface ScoreInput {
  assets: DecryptedAsset[]
  members: FamilyMember[]
  reminders: UpcomingReminder[]
  hasRecoveryEnvelope: boolean
}

export interface ScoreBreakdown {
  total: number                       // 0–100
  assetBreadth: number                // 0–15
  everythingCurrent: number           // 0–10
  nomineeCoverage: number             // 0–15
  documentCompleteness: number        // 0–15
  upcomingDatesHandled: number        // 0–10
  hasInsurance: number                // 0–10
  trustedContactVerified: number      // 0–10
  recoveryEnvelopeDistributed: number // 0–5
  willLogged: number                  // 0–5
  emergencyBuffer: number             // 0–5
}

export interface ScoreSuggestion {
  component: keyof ScoreBreakdown
  message: string                     // organisational only, no investment advice
  learnMoreUrl?: string               // curated third-party link only
}

// ── component calculations ────────────────────────────────────────────────────

/** 15pts — how many of the 8 asset types are represented */
function scoreAssetBreadth(assets: DecryptedAsset[]): number {
  const types = new Set(assets.filter(a => a.status === 'active').map(a => a.type))
  if (types.size === 0) return 0
  if (types.size <= 2)  return 5
  if (types.size <= 4)  return 10
  return 15
}

/** 10pts — are assets updated recently (within 90 days)? */
function scoreEverythingCurrent(assets: DecryptedAsset[]): number {
  const active = assets.filter(a => a.status === 'active')
  if (active.length === 0) return 0
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)
  const fresh = active.filter(a => new Date(a.updatedAt) >= cutoff)
  return Math.round(10 * (fresh.length / active.length))
}

/** 15pts — % of active assets that have at least one nominee */
function scoreNomineeCoverage(assets: DecryptedAsset[]): number {
  const active = assets.filter(a => a.status === 'active')
  if (active.length === 0) return 0
  const withNominee = active.filter(a => a.nominees.length > 0)
  return Math.round(15 * (withNominee.length / active.length))
}

/** 15pts — % of assets with a physical_location noted or at least one document */
function scoreDocumentCompleteness(assets: DecryptedAsset[]): number {
  const active = assets.filter(a => a.status === 'active')
  if (active.length === 0) return 0
  const withDoc = active.filter(a => {
    const f = a.fields as Record<string, unknown>
    return (typeof f.physical_location === 'string' && f.physical_location.trim().length > 0)
  })
  return Math.round(15 * (withDoc.length / active.length))
}

/** 10pts — no reminders overdue or due within 3 days */
function scoreUpcomingDatesHandled(reminders: UpcomingReminder[]): number {
  if (reminders.length === 0) return 10
  const urgent = reminders.filter(r => r.daysUntil <= 3)
  if (urgent.length === 0) return 10
  if (urgent.length === 1) return 5
  return 0
}

/** 10pts — at least one life/health/term insurance policy logged */
function scoreHasInsurance(assets: DecryptedAsset[]): number {
  const hasIt = assets.some(a => {
    if (a.status !== 'active' || a.type !== 'insurance') return false
    const f = a.fields as Record<string, unknown>
    return ['life', 'health', 'term'].includes(f.policy_type as string)
  })
  return hasIt ? 10 : 0
}

/** 10pts — a trusted_contact member exists */
function scoreTrustedContact(members: FamilyMember[]): number {
  return members.some(m => m.role === 'trusted_contact') ? 10 : 0
}

/** 5pts — recovery envelope has been distributed */
function scoreRecoveryEnvelope(hasRecoveryEnvelope: boolean): number {
  return hasRecoveryEnvelope ? 5 : 0
}

/** 5pts — a will or legal document reference is logged */
function scoreWillLogged(assets: DecryptedAsset[]): number {
  const hasWill = assets.some(a => {
    if (a.status !== 'active' || a.type !== 'other') return false
    const f = a.fields as Record<string, unknown>
    const title = (f.title as string ?? '').toLowerCase()
    const notes = (f.notes as string ?? '').toLowerCase()
    return title.includes('will') || title.includes('testament') ||
           notes.includes('will') || notes.includes('testament')
  })
  return hasWill ? 5 : 0
}

/** 5pts — at least one bank account or liquid fund logged (emergency buffer presence) */
function scoreEmergencyBuffer(assets: DecryptedAsset[]): number {
  const hasBuffer = assets.some(a => {
    if (a.status !== 'active') return false
    if (a.type === 'bank_account') return true
    if (a.type === 'mutual_fund') {
      const f = a.fields as Record<string, unknown>
      const scheme = (f.scheme_name as string ?? '').toLowerCase()
      return scheme.includes('liquid') || scheme.includes('overnight') || scheme.includes('money market')
    }
    return false
  })
  return hasBuffer ? 5 : 0
}

// ── main entry point ──────────────────────────────────────────────────────────

export function calculateScore(input: ScoreInput): ScoreBreakdown {
  const { assets, members, reminders, hasRecoveryEnvelope } = input

  const assetBreadth                = scoreAssetBreadth(assets)
  const everythingCurrent           = scoreEverythingCurrent(assets)
  const nomineeCoverage             = scoreNomineeCoverage(assets)
  const documentCompleteness        = scoreDocumentCompleteness(assets)
  const upcomingDatesHandled        = scoreUpcomingDatesHandled(reminders)
  const hasInsurance                = scoreHasInsurance(assets)
  const trustedContactVerified      = scoreTrustedContact(members)
  const recoveryEnvelopeDistributed = scoreRecoveryEnvelope(hasRecoveryEnvelope)
  const willLogged                  = scoreWillLogged(assets)
  const emergencyBuffer             = scoreEmergencyBuffer(assets)

  const total =
    assetBreadth +
    everythingCurrent +
    nomineeCoverage +
    documentCompleteness +
    upcomingDatesHandled +
    hasInsurance +
    trustedContactVerified +
    recoveryEnvelopeDistributed +
    willLogged +
    emergencyBuffer

  return {
    total,
    assetBreadth,
    everythingCurrent,
    nomineeCoverage,
    documentCompleteness,
    upcomingDatesHandled,
    hasInsurance,
    trustedContactVerified,
    recoveryEnvelopeDistributed,
    willLogged,
    emergencyBuffer,
  }
}

// ── suggestions ───────────────────────────────────────────────────────────────

/**
 * Returns actionable suggestions based on which components scored zero.
 * Organisational only — no investment advice, no SEBI-regulated recommendations.
 */
export function getSuggestions(breakdown: ScoreBreakdown): ScoreSuggestion[] {
  const suggestions: ScoreSuggestion[] = []

  if (breakdown.assetBreadth < 15) {
    suggestions.push({
      component: 'assetBreadth',
      message: 'Add more asset types to get a complete picture of your family finances.',
    })
  }

  if (breakdown.nomineeCoverage < 15) {
    suggestions.push({
      component: 'nomineeCoverage',
      message: 'Some assets are missing nominees. Add nominees so your family is always protected.',
      learnMoreUrl: 'https://www.sebi.gov.in/investor/faq/nomination.html',
    })
  }

  if (breakdown.documentCompleteness < 15) {
    suggestions.push({
      component: 'documentCompleteness',
      message: "Note where physical documents are stored for each asset — it'll save your family hours if they ever need to find them.",
    })
  }

  if (breakdown.upcomingDatesHandled === 0) {
    suggestions.push({
      component: 'upcomingDatesHandled',
      message: 'You have payments or renewals due very soon. Review your calendar.',
    })
  }

  if (breakdown.hasInsurance === 0) {
    suggestions.push({
      component: 'hasInsurance',
      message: 'No life or health insurance is logged. Add your policies so your family can find them.',
      learnMoreUrl: 'https://www.irdai.gov.in/consumer-education',
    })
  }

  if (breakdown.trustedContactVerified === 0) {
    suggestions.push({
      component: 'trustedContactVerified',
      message: 'Set up a trusted contact so your family can access the vault if something happens to you.',
    })
  }

  if (breakdown.willLogged === 0) {
    suggestions.push({
      component: 'willLogged',
      message: 'Log a reference to your will or legal documents so your family knows where to find them.',
      learnMoreUrl: 'https://lawcommissionofindia.nic.in/reports/report110.pdf',
    })
  }

  if (breakdown.emergencyBuffer === 0) {
    suggestions.push({
      component: 'emergencyBuffer',
      message: 'Log a bank account or liquid fund so your family has a clear emergency buffer.',
    })
  }

  return suggestions
}
