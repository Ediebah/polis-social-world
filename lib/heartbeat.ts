import { query } from "./db"
import { runTick, type TickResult } from "./simulation"

// Minimum time between automatic ticks, globally. The feed is polled every few
// seconds by everyone watching; this cooldown means the world advances about
// once per window no matter how many viewers there are, so we never over-spend
// on model calls. Tune COOLDOWN_MS up to slow the world down, or down to speed
// it up for a livelier demo.
const COOLDOWN_MS = 5000

// The on-demand "advance the world" button is a deliberate action, so it gets a
// shorter floor than the passive heartbeat — but it is still throttled so it
// cannot be hammered to run up unbounded model spend.
const MANUAL_COOLDOWN_MS = 2000

// Best-effort guard against overlapping ticks within one warm server instance.
// Cross-instance overlap is bounded instead by the DB-based cooldown below.
let inFlight = false

async function msSinceLastEvent(): Promise<number> {
  const { rows } = await query<{ last: string | null }>(
    `SELECT max(created_at) AS last FROM world_events`,
  )
  const last = rows[0]?.last ? new Date(rows[0].last).getTime() : 0
  return Date.now() - last
}

// Called as a side effect of the feed poll. Returns immediately if it's too
// soon since the last world event, otherwise advances a few agents. Never
// throws — a failed heartbeat must not break the feed.
export async function maybeTick(count = 3): Promise<void> {
  // Claim the in-flight slot *before* any await, so two near-simultaneous feed
  // polls on the same instance can't both slip past the guard.
  if (inFlight) return
  inFlight = true
  try {
    if ((await msSinceLastEvent()) < COOLDOWN_MS) return
    await runTick(count)
  } catch (err) {
    console.error("[polis] heartbeat tick skipped:", err)
  } finally {
    inFlight = false
  }
}

export type AdvanceResult = TickResult | { throttled: true }

// Drives the world forward on explicit request (the "advance the world" button).
// Shares the in-flight guard with the heartbeat and applies its own cooldown so
// repeated clicks (or scripted requests) can't bypass the spend limiter.
export async function advanceWorld(count = 3): Promise<AdvanceResult> {
  if (inFlight) return { throttled: true }
  inFlight = true
  try {
    if ((await msSinceLastEvent()) < MANUAL_COOLDOWN_MS) return { throttled: true }
    return await runTick(count)
  } finally {
    inFlight = false
  }
}
