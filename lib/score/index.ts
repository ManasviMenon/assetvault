export interface ScoreBreakdown {
  total: number
  assetBreadth: number
  everythingCurrent: number
  nomineeCoverage: number
  documentCompleteness: number
  upcomingDatesHandled: number
  hasInsurance: number
  trustedContactVerified: number
  recoveryEnvelopeDistributed: number
  willLogged: number
  emergencyBuffer: number
}

// Full scoring logic wired in Step 10 once assets exist.
// Returns 0 across the board until then.
export function calculateScore(): ScoreBreakdown {
  return {
    total: 0,
    assetBreadth: 0,
    everythingCurrent: 0,
    nomineeCoverage: 0,
    documentCompleteness: 0,
    upcomingDatesHandled: 0,
    hasInsurance: 0,
    trustedContactVerified: 0,
    recoveryEnvelopeDistributed: 0,
    willLogged: 0,
    emergencyBuffer: 0,
  }
}
