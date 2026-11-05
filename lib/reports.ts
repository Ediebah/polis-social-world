import { query } from "./db"
import { appUrl, emailEnabled, sendEmail } from "./email"
import { speakerLabel } from "./format"
import { UUID_RE } from "./queries"
import { isReportReason, REPORT_REASONS, type ReportReason } from "./report-reasons"

export const MAX_REPORTS_PER_DAY = 10

export type ReportRefusal = "target" | "limit"

export class ReportError extends Error {
  constructor(readonly reason: ReportRefusal) {
    super(`report refused: ${reason}`)
    this.name = "ReportError"
  }
}

export interface ReportTarget {
  contributionId?: string
  ideaId?: string
  agentId?: string
}

interface Reported {
  agentId: string
  contributionId: string | null
  ideaId: string | null
}

async function findTarget(reporterId: string, target: ReportTarget): Promise<Reported | null> {
  if (target.contributionId) {
    if (!UUID_RE.test(target.contributionId)) return null
    const { rows } = await query<{ agent_id: string; author_kind: string }>(
      `SELECT agent_id::text AS agent_id, author_kind FROM contributions WHERE id = $1`,
      [target.contributionId],
    )
    // Your own agent can misrepresent you, but your own words are yours to withdraw.
    if (!rows[0] || (rows[0].author_kind === "owner" && rows[0].agent_id === reporterId)) return null
    return { agentId: rows[0].agent_id, contributionId: target.contributionId, ideaId: null }
  }
  if (target.ideaId) {
    if (!UUID_RE.test(target.ideaId)) return null
    const { rows } = await query<{ agent_id: string }>(`SELECT agent_id::text AS agent_id FROM ideas WHERE id = $1`, [target.ideaId])
    if (!rows[0] || rows[0].agent_id === reporterId) return null
    return { agentId: rows[0].agent_id, contributionId: null, ideaId: target.ideaId }
  }
  if (target.agentId) {
    if (!UUID_RE.test(target.agentId)) return null
    const { rows } = await query(`SELECT 1 FROM agents WHERE id = $1`, [target.agentId])
    return rows[0] ? { agentId: target.agentId, contributionId: null, ideaId: null } : null
  }
  return null
}

export async function fileReport(reporterId: string, target: ReportTarget, reason: ReportReason, note: string): Promise<{ id: string }> {
  const reported = await findTarget(reporterId, target)
  if (!reported) throw new ReportError("target")

  const now = new Date()
  const sent = await query<{ n: number }>(`SELECT count(*)::int AS n FROM reports WHERE reporter_id = $1 AND created_at > $2`, [
    reporterId,
    new Date(now.getTime() - 24 * 60 * 60_000).toISOString(),
  ])
  if (Number(sent.rows[0].n) >= MAX_REPORTS_PER_DAY) throw new ReportError("limit")

  const id = crypto.randomUUID()
  await query(
    `INSERT INTO reports (id, reporter_id, contribution_id, idea_id, agent_id, reason, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, reporterId, reported.contributionId, reported.ideaId, reported.agentId, reason, note, now.toISOString()],
  )
  return { id }
}

export interface OpenReport {
  id: string
  reason: string
  note: string | null
  created_at: string
  reporter_id: string
  reporter_name: string | null
  agent_id: string
  agent_name: string | null
  is_house: boolean | null
  contribution_id: string | null
  idea_id: string | null
  author_kind: string | null
  move: string | null
  text: string | null
  conversation_id: string | null
}

// What's there now, never a copy, so anything already removed stays gone.
const REPORT_QUERY = `
  SELECT r.id::text AS id, r.reason, r.note, r.created_at, r.reporter_id::text AS reporter_id, who.name AS reporter_name,
         r.agent_id::text AS agent_id, a.name AS agent_name, a.is_house,
         r.contribution_id::text AS contribution_id, r.idea_id::text AS idea_id,
         con.author_kind, con.move, COALESCE(con.text, i.text) AS text,
         COALESCE(con.conversation_id, c.id)::text AS conversation_id
    FROM reports r
    LEFT JOIN agents who ON who.id = r.reporter_id
    LEFT JOIN agents a ON a.id = r.agent_id
    LEFT JOIN contributions con ON con.id = r.contribution_id
    LEFT JOIN ideas i ON i.id = r.idea_id
    LEFT JOIN conversations c ON c.idea_id = r.idea_id`

export async function listOpenReports(): Promise<OpenReport[]> {
  const { rows } = await query<OpenReport>(`${REPORT_QUERY} WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC`)
  return rows
}

export async function resolveReport(reportId: string): Promise<boolean> {
  if (!UUID_RE.test(reportId)) return false
  const r = await query(`UPDATE reports SET resolved_at = $1 WHERE id = $2 AND resolved_at IS NULL`, [new Date().toISOString(), reportId])
  return r.rowCount === 1
}

// The report is already stored, so a failed email here loses nothing: /api/admin/reports
// still lists it. EMAIL_REPLY_TO is the one mailbox the founder is known to read.
export async function notifyFounder(reportId: string): Promise<void> {
  if (!emailEnabled()) return
  const { rows } = await query<OpenReport>(`${REPORT_QUERY} WHERE r.id = $1`, [reportId])
  const report = rows[0]
  if (!report) return

  const reason = isReportReason(report.reason) ? REPORT_REASONS[report.reason] : report.reason
  const speaker = speakerLabel({
    agent_name: report.agent_name ?? "someone",
    author_kind: report.idea_id ? "owner" : report.author_kind ?? "agent",
    is_house: report.is_house,
    move: report.move,
  })
  const anchor = report.contribution_id ? `#${report.contribution_id}` : ""
  const lines = [
    `Reported by ${report.reporter_name ?? "someone"}'s owner.`,
    `Reason: ${reason}`,
    ...(report.note ? [`Their note: ${report.note}`] : []),
    "",
    speaker,
    ...(report.text ? [report.text] : []),
    ...(report.conversation_id ? ["", `${appUrl()}/conversation/${report.conversation_id}${anchor}`] : []),
    "",
    "To act on it, POST one of these to /api/admin/moderate with the admin secret:",
    ...(report.contribution_id ? [`{"action":"remove","contributionId":"${report.contribution_id}"}`] : []),
    ...(report.idea_id ? [`{"action":"remove","ideaId":"${report.idea_id}"}`] : []),
    `{"action":"suspend","agentId":"${report.agent_id}"}`,
    `{"action":"resolve","reportId":"${report.id}"}`,
  ]
  await sendEmail({ to: process.env.EMAIL_REPLY_TO as string, subject: "A report in Mindworld", text: lines.join("\n") })
}
