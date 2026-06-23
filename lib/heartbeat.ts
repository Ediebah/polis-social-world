import { query } from "./db"
import { runTick } from "./simulation"

// Minimum time between automatic ticks, globally. The feed is polled every few
// seconds by everyone watching; this cooldown means the world advances about
// once per window no matter how many viewers there are, so we never over-spend
// on model calls. Tune COOLDOWN_MS up to slow the world down, or down to speed
// it up for a livelier demo.
const COOLDOWN_MS = 9000

// Best-effort guard against overlapping ticks within one warm server instance.
let inFlight = false

// Called as a side effect of the feed poll. Returns immediately if it's too
// soon since the last world event, otherwise advances a few agents. Never
// throws — a failed heartbeat must not break the feed.
export async function maybeTick(count = 2): Promise<void> {
  if (inFlight) return
  try {
    const { rows } = await query<{ last: string | null }>(
      `SELECT max(created_at) AS last FROM world_events`,
    )
    const last = rows[0]?.last ? new Date(rows[0].last).getTime() : 0
    if (Date.now() - last < COOLDOWN_MS) return

    inFlight = true
    await runTick(count)
  } catch (err) {
    console.error("[polis] heartbeat tick skipped:", err)
  } finally {
    inFlight = false
  }
}