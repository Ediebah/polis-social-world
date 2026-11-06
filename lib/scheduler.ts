import { query } from "./db"
import { retryOnConflict } from "./occ"
import { runTick, type StopReason } from "./simulation"
import { isPaused } from "./spend"

// The world advances once per slot, no matter how many triggers fire. A worker
// that dies loses only its own slot: the next slot has its own key, and agents it
// never reached are still first in line.
const SLOT_MS = 15 * 60_000
const AGENTS_PER_SLOT = 3

// Measured from the start of the run. Keep the route's maxDuration above this, so
// the last agent's model call and commit can finish.
const RUN_TIME_LIMIT_MS = 90_000

export type ScheduledRun =
  | { status: "paused" }
  | { status: "slot-taken"; slot: string }
  | {
      status: "ran"
      slot: string
      ticked: number
      skipped: number
      errors: number
      stopReason: StopReason | null
    }

function currentSlot(): string {
  return new Date(Math.floor(Date.now() / SLOT_MS) * SLOT_MS).toISOString()
}

// The first trigger to insert the slot's row wins (rowCount 1). A trigger that
// loses a write conflict retries and then finds the row taken.
async function claimSlot(slot: string): Promise<boolean> {
  return retryOnConflict(async () => {
    const r = await query(
      `INSERT INTO tick_runs (slot, started_at) VALUES ($1, $2)
       ON CONFLICT (slot) DO NOTHING`,
      [slot, new Date().toISOString()],
    )
    return (r.rowCount ?? 0) === 1
  })
}

export async function runScheduledSlot(): Promise<ScheduledRun> {
  if (await isPaused()) return { status: "paused" }

  const slot = currentSlot()
  if (!(await claimSlot(slot))) return { status: "slot-taken", slot }

  const result = await runTick({ count: AGENTS_PER_SLOT, deadlineAt: Date.now() + RUN_TIME_LIMIT_MS })

  await retryOnConflict(() =>
    query(
      `UPDATE tick_runs
          SET finished_at = $2, ticked = $3, skipped = $4, errors = $5, stop_reason = $6
        WHERE slot = $1`,
      [slot, new Date().toISOString(), result.ticked, result.skipped, result.errors, result.stopReason],
    ),
  )
  return { status: "ran", slot, ...result }
}

// When a run last changed the world, so the UI can show it. Runs where every agent
// failed or none was due don't count.
export async function getLastUpdateAt(): Promise<string | null> {
  const { rows } = await query<{ last: Date | string | null }>(
    `SELECT max(finished_at) AS last FROM tick_runs WHERE ticked > 0`,
  )
  const last = rows[0]?.last
  return last ? new Date(last).toISOString() : null
}
