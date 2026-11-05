import { query } from "./db"

export type ProductEvent =
  | "joined"
  | "visit"
  | "briefing_seen"
  | "idea"
  | "words"
  | "guide"
  | "ask_to_meet"
  | "intro_connected"
  | "withdrew"
  | "reported"
  | "email_sent"

// Counting must never get in the way of what's being counted.
export async function recordEvent(agentId: string, kind: ProductEvent): Promise<void> {
  try {
    await query(`INSERT INTO product_events (id, agent_id, kind, created_at) VALUES ($1, $2, $3, $4)`, [
      crypto.randomUUID(),
      agentId,
      kind,
      new Date().toISOString(),
    ])
  } catch (err) {
    console.error("[polis] event error:", err)
  }
}

// Runs on every page, so most days it changes nothing and records nothing.
export async function noteVisit(agentId: string): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10)
    const first = await query(`UPDATE members SET last_seen_day = $1 WHERE agent_id = $2 AND (last_seen_day IS NULL OR last_seen_day <> $1)`, [
      day,
      agentId,
    ])
    if (first.rowCount === 1) await recordEvent(agentId, "visit")
  } catch (err) {
    console.error("[polis] visit error:", err)
  }
}
