import { beforeEach, describe, expect, it, vi } from "vitest"
import { spawnAgentAction } from "@/app/actions"
import { getWorldCounts, spawnAgent } from "@/lib/queries"
import { runScheduledSlot } from "@/lib/scheduler"
import { query } from "./helpers/fake-db"
import { model, onModelCall, textResult } from "./helpers/fake-model"

const ACTION = JSON.stringify({ type: "move", text: "a thought", to: "studio", idea_ref: null, conversation_ref: null, kind: null, takeaway: null, memory_ref: null })

const spawn = (name = "Ada") =>
  spawnAgent({
    handle: name.toLowerCase(),
    name,
    traits: ["curious", "bold", "loyal"],
    backstory: "A long enough backstory.",
    goal: "Find a good question.",
    location: "plaza",
  })

async function spawnUpToLimit(attempts: number) {
  let accepted = 0
  for (let i = 0; i < attempts; i++) {
    try {
      await spawn(`Spam${i}`)
      accepted++
    } catch {
      // Over the limit: keep trying, the way a spammer would.
    }
  }
  return accepted
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-02T00:00:00Z"))
})

describe("daily spawn limit", () => {
  it("stops accepting citizens at the limit and reopens the next UTC day", async () => {
    await expect(spawnUpToLimit(52)).resolves.toBe(50)
    expect((await getWorldCounts()).population).toBe(50)

    vi.setSystemTime(new Date("2026-11-03T00:00:00Z"))

    await expect(spawn("Tomorrow")).resolves.toMatchObject({ id: expect.any(String) })
  })

  it("leaves nothing behind when a spawn is refused", async () => {
    await spawnUpToLimit(50)

    await expect(spawn("Late")).rejects.toThrow()

    const { rows } = await query(`SELECT count(*)::int AS n FROM users`)
    expect(rows[0].n).toBe(50)
  })

  it("tells the person why, instead of a generic error", async () => {
    await spawnUpToLimit(50)
    const form = new FormData()
    form.set("name", "Late Arrival")
    form.set("backstory", "A long enough backstory.")
    form.set("goal", "Find a good question.")
    for (const trait of ["curious", "ambitious", "cautious"]) form.append("traits", trait)

    const result = await spawnAgentAction({}, form)

    expect(result.error).toMatch(/tomorrow/i)
  })

  it("can't be used to stop existing citizens from ever acting", async () => {
    const id = crypto.randomUUID()
    await query(
      `INSERT INTO agents (id, owner_user_id, name, persona, goal, location, balance, reputation, next_tick_seq, status, last_tick_at, created_at)
       VALUES ($1, $2, 'Resident', '{"traits":[],"backstory":""}'::jsonb, 'a goal', 'plaza', 1000, 0, 0, 'alive', '2026-10-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [id, crypto.randomUUID()],
    )
    onModelCall(async () => textResult(ACTION))

    // A day's worth of slots has 288 turns, so 300 spawns would fill all of them.
    await spawnUpToLimit(300)
    const start = Date.now()
    for (let slot = 0; slot < 96; slot++) {
      vi.setSystemTime(start + slot * 15 * 60_000)
      await runScheduledSlot()
    }

    const asked = model.doGenerateCalls.filter((call) => JSON.stringify(call.prompt).includes("You are Resident."))
    expect(asked.length).toBeGreaterThan(0)
  }, 60_000)
})
