import { query } from "./db"

const DAY_MS = 24 * 60 * 60_000
const ACTIONS = new Set(["idea", "words", "ask_to_meet"])
const MICROS_PER_USD = 1_000_000

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

// The pilot's measures, as counts of people. What people said about it comes from interviews.
export async function getPilotMetrics() {
  const [events, reports, spend] = await Promise.all([
    query<{ agent_id: string; kind: string; created_at: string }>(`SELECT agent_id::text AS agent_id, kind, created_at FROM product_events`),
    query<{ reason: string; resolved_at: string | null }>(`SELECT reason, resolved_at FROM reports`),
    query<{ micros: string | number | null }>(`SELECT sum(reserved_micros) AS micros FROM spend_days`),
  ])

  const byPerson = new Map<string, { kind: string; at: number }[]>()
  for (const e of events.rows) {
    const list = byPerson.get(e.agent_id) ?? []
    list.push({ kind: e.kind, at: new Date(e.created_at).getTime() })
    byPerson.set(e.agent_id, list)
  }

  const people = [...byPerson.values()]
  const joinedAt = (list: { kind: string; at: number }[]) => list.find((e) => e.kind === "joined")?.at
  const count = (test: (list: { kind: string; at: number }[]) => boolean) => people.filter(test).length

  // What was reserved, which errs high. The provider's bill has the real number.
  const estimatedModelCostUsd = Number(spend.rows[0]?.micros ?? 0) / MICROS_PER_USD
  const activeParticipants = count((list) => list.some((e) => e.kind === "visit"))

  return {
    joined: count((list) => joinedAt(list) !== undefined),
    returnedOnLaterDay: count((list) => {
      const joined = joinedAt(list)
      return joined !== undefined && list.some((e) => e.kind === "visit" && utcDay(e.at) > utcDay(joined))
    }),
    activeInWeekTwo: count((list) => {
      const joined = joinedAt(list)
      return joined !== undefined && list.some((e) => e.kind !== "email_sent" && e.at >= joined + 7 * DAY_MS && e.at < joined + 14 * DAY_MS)
    }),
    actedAfterBriefing: count((list) =>
      list.some((seen) => seen.kind === "briefing_seen" && list.some((e) => ACTIONS.has(e.kind) && e.at > seen.at && e.at <= seen.at + DAY_MS)),
    ),
    mutualIntroductions: events.rows.filter((e) => e.kind === "intro_connected").length,
    emailsSent: events.rows.filter((e) => e.kind === "email_sent").length,
    reports: reports.rows.length,
    openReports: reports.rows.filter((r) => !r.resolved_at).length,
    misrepresentationReports: reports.rows.filter((r) => r.reason === "misrepresents_me").length,
    estimatedModelCostUsd,
    activeParticipants,
    estimatedModelCostPerActiveParticipantUsd: activeParticipants > 0 ? estimatedModelCostUsd / activeParticipants : null,
  }
}
