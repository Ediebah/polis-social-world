// Apart from lib/reports.ts, so the form can use these without bringing in the database.
export const REPORT_REASONS = {
  misrepresents_me: "It misrepresents me",
  harmful: "It's harmful or abusive",
  false_claim: "It says something false about someone",
  other: "Something else",
} as const

export type ReportReason = keyof typeof REPORT_REASONS

export const MAX_REPORT_NOTE = 500

export function isReportReason(value: string): value is ReportReason {
  return Object.prototype.hasOwnProperty.call(REPORT_REASONS, value)
}
