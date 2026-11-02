import { beforeEach, describe, expect, it, vi } from "vitest"
import { getLastUpdateAt, runScheduledSlot } from "@/lib/scheduler"
import { getSpendStatus, setPaused } from "@/lib/spend"
import { failNext, query } from "./helpers/fake-db"
import { model, modelCallCount, onModelCall, textResult } from "./helpers/fake-model"

const ACTION = JSON.stringify({ type: "post", text: "a thought", to: null, item: null, price: null, with_agent: null })

function at(iso: string) {
  vi.setSystemTime(new Date(iso))
}

async function addAgent(
  name: string,
  times: { createdAt?: string; lastTickAt?: string; lastAttemptAt?: string } = {},
) {
  const id = crypto.randomUUID()
  await query(
    `INSERT INTO agents (id, owner_user_id, name, persona, goal, location, balance, reputation, next_tick_seq, status, last_tick_at, last_attempt_at, created_at)
     VALUES ($1, $2, $3, '{"traits":[],"backstory":""}'::jsonb, 'a goal', 'plaza', 1000, 0, 0, 'alive', $4, $5, $6)`,
    [
      id,
      crypto.randomUUID(),
      name,
      times.lastTickAt ?? null,
      times.lastAttemptAt ?? null,
      times.createdAt ?? "2026-01-01T00:00:00Z",
    ],
  )
  return id
}

// Who the model was asked to decide for, in order.
function agentsAsked(): string[] {
  return model.doGenerateCalls.map((call) => {
    const match = JSON.stringify(call.prompt).match(/You are (\w+)\./)
    return match ? match[1] : "unknown"
  })
}

async function runRow(slot: string) {
  const { rows } = await query(`SELECT * FROM tick_runs WHERE slot = $1`, [slot])
  return rows[0]
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  at("2026-11-02T10:01:00Z")
  onModelCall(async () => textResult(ACTION))
})

describe("scheduled slots", () => {
  it("runs a slot once when two triggers arrive within the same 15 minutes", async () => {
    await addAgent("Ada")
    await addAgent("Bea")

    const first = await runScheduledSlot()
    at("2026-11-02T10:14:59Z")
    const second = await runScheduledSlot()

    expect(first).toMatchObject({ status: "ran", slot: "2026-11-02T10:00:00.000Z", ticked: 2 })
    expect(second).toEqual({ status: "slot-taken", slot: "2026-11-02T10:00:00.000Z" })
    expect(modelCallCount()).toBe(2)
  })

  it("runs again in the next slot", async () => {
    await addAgent("Ada", { lastTickAt: "2026-11-02T01:00:00Z" })
    await runScheduledSlot()
    await addAgent("Bea")

    at("2026-11-02T10:15:00Z")
    const next = await runScheduledSlot()

    expect(next).toMatchObject({ status: "ran", slot: "2026-11-02T10:15:00.000Z", ticked: 1 })
    expect(agentsAsked()).toEqual(["Ada", "Bea"])
  })

  it("records what the run did and when it finished", async () => {
    await addAgent("Ada")

    await runScheduledSlot()

    const row = await runRow("2026-11-02T10:00:00.000Z")
    expect(new Date(row.finished_at as string).toISOString()).toBe("2026-11-02T10:01:00.000Z")
    expect(row).toMatchObject({ ticked: 1, skipped: 0, errors: 0, stop_reason: null })
  })

  it("loses only its own slot when a worker dies midway", async () => {
    await addAgent("Ada")
    // A worker claimed this slot and was killed before reaching anyone.
    await query(`INSERT INTO tick_runs (slot, started_at) VALUES ($1, $2)`, [
      "2026-11-02T10:00:00.000Z",
      "2026-11-02T10:00:30Z",
    ])

    const sameSlot = await runScheduledSlot()
    expect(sameSlot).toMatchObject({ status: "slot-taken" })
    expect(modelCallCount()).toBe(0)
    expect(await getLastUpdateAt()).toBeNull()

    at("2026-11-02T10:15:00Z")
    const nextSlot = await runScheduledSlot()

    expect(nextSlot).toMatchObject({ status: "ran", ticked: 1 })
    expect(agentsAsked()).toEqual(["Ada"])
  })

  it("leaves the run unfinished when it fails outright, and the next slot still works", async () => {
    await addAgent("Ada")
    failNext(/FROM agents/, "XX000")

    await expect(runScheduledSlot()).rejects.toMatchObject({ code: "XX000" })
    expect((await runRow("2026-11-02T10:00:00.000Z")).finished_at).toBeNull()

    at("2026-11-02T10:15:00Z")
    await expect(runScheduledSlot()).resolves.toMatchObject({ status: "ran", ticked: 1 })
  })

  it("does not claim the slot while the city is paused", async () => {
    await addAgent("Ada")
    await setPaused(true)

    await expect(runScheduledSlot()).resolves.toEqual({ status: "paused" })
    expect(await runRow("2026-11-02T10:00:00.000Z")).toBeUndefined()

    await setPaused(false)
    await expect(runScheduledSlot()).resolves.toMatchObject({ status: "ran", ticked: 1 })
  })
})

describe("last update", () => {
  it("is empty before anything has run", async () => {
    expect(await getLastUpdateAt()).toBeNull()
  })

  it("is the latest run in which someone actually acted", async () => {
    await addAgent("Ada")
    await runScheduledSlot()
    at("2026-11-02T10:15:00Z")
    onModelCall(async () => {
      throw new Error("model down")
    })
    await addAgent("Bea")
    await runScheduledSlot()

    const last = await getLastUpdateAt()

    expect(new Date(last as string).toISOString()).toBe("2026-11-02T10:01:00.000Z")
  })
})

describe("who acts", () => {
  it("runs at most three agents per slot", async () => {
    for (const name of ["Ada", "Bea", "Cal", "Dot"]) await addAgent(name)

    await expect(runScheduledSlot()).resolves.toMatchObject({ ticked: 3 })
    expect(modelCallCount()).toBe(3)
  })

  it("puts citizens who have never acted ahead of those who have", async () => {
    await addAgent("Old", { createdAt: "2026-01-01T00:00:00Z", lastTickAt: "2026-02-01T00:00:00Z" })
    await addAgent("Ada", { createdAt: "2026-11-02T09:00:00Z" })
    await addAgent("Bea", { createdAt: "2026-11-02T09:30:00Z" })
    await addAgent("Cal", { createdAt: "2026-11-02T09:45:00Z" })

    await runScheduledSlot()

    expect(agentsAsked()).toEqual(["Ada", "Bea", "Cal"])
  })

  it("serves whoever has waited longest among citizens who have acted", async () => {
    await addAgent("Recent", { lastTickAt: "2026-11-01T09:00:00Z" })
    await addAgent("Oldest", { lastTickAt: "2026-10-30T09:00:00Z" })
    await addAgent("Middle", { lastTickAt: "2026-10-31T09:00:00Z" })

    await runScheduledSlot()

    expect(agentsAsked()).toEqual(["Oldest", "Middle", "Recent"])
  })

  it("moves a failing agent out of the way instead of letting it hold the front", async () => {
    await addAgent("Ada", { createdAt: "2026-01-01T00:00:00Z" })
    await addAgent("Bea", { createdAt: "2026-01-02T00:00:00Z" })
    await addAgent("Cal", { createdAt: "2026-01-03T00:00:00Z" })
    await addAgent("Dot", { createdAt: "2026-01-04T00:00:00Z" })
    onModelCall(async (options) => {
      if (JSON.stringify(options.prompt).includes("You are Ada.")) throw new Error("bad agent")
      return textResult(ACTION)
    })

    const first = await runScheduledSlot()
    at("2026-11-02T10:15:00Z")
    const second = await runScheduledSlot()

    expect(first).toMatchObject({ ticked: 2, errors: 1 })
    expect(second).toMatchObject({ ticked: 1, errors: 0 })
    expect(agentsAsked()).toEqual(["Ada", "Bea", "Cal", "Dot"])
  })

  it("doesn't let citizens whose first attempts keep failing crowd out those who have acted", async () => {
    for (const name of ["Ada", "Bea", "Cal"]) await addAgent(name, { lastAttemptAt: "2026-11-02T05:00:00Z" })
    await addAgent("Old", { lastTickAt: "2026-11-02T04:00:00Z" })

    await runScheduledSlot()

    expect(agentsAsked()).toContain("Old")
  })

  it("lets an agent act at most six times in 24 hours", async () => {
    await addAgent("Ada")

    const start = Date.parse("2026-11-02T00:00:00Z")
    for (let slot = 0; slot < 96; slot++) {
      vi.setSystemTime(start + slot * 15 * 60_000)
      await runScheduledSlot()
    }

    expect(modelCallCount()).toBe(6)
  })

  it("does not spend anything when no one is due", async () => {
    await addAgent("Ada", { lastAttemptAt: "2026-11-02T09:00:00Z" })

    await expect(runScheduledSlot()).resolves.toMatchObject({ status: "ran", ticked: 0, errors: 0 })
    expect(modelCallCount()).toBe(0)
    expect((await getSpendStatus()).calls).toBe(0)
  })
})

describe("stopping early", () => {
  it("stops when the budget runs out and leaves agents' turns unused", async () => {
    vi.stubEnv("DAILY_SPEND_CAP_USD", "0")
    await addAgent("Ada")
    await addAgent("Bea")

    const blocked = await runScheduledSlot()

    expect(blocked).toMatchObject({ status: "ran", ticked: 0, errors: 0, stopReason: "cap" })
    expect(modelCallCount()).toBe(0)
    expect((await runRow("2026-11-02T10:00:00.000Z")).stop_reason).toBe("cap")

    vi.unstubAllEnvs()
    at("2026-11-02T10:15:00Z")
    await expect(runScheduledSlot()).resolves.toMatchObject({ ticked: 2 })
  })

  it("stops starting agents near the time limit", async () => {
    for (const name of ["Ada", "Bea", "Cal"]) await addAgent(name)
    onModelCall(async () => {
      vi.setSystemTime(Date.now() + 70_000)
      return textResult(ACTION)
    })

    const run = await runScheduledSlot()

    expect(run).toMatchObject({ status: "ran", ticked: 1, stopReason: "deadline" })
    expect(modelCallCount()).toBe(1)
  })

  it("keeps a slow-but-normal run going", async () => {
    for (const name of ["Ada", "Bea", "Cal"]) await addAgent(name)
    onModelCall(async () => {
      vi.setSystemTime(Date.now() + 20_000)
      return textResult(ACTION)
    })

    await expect(runScheduledSlot()).resolves.toMatchObject({ ticked: 3, stopReason: null })
  })
})

describe("committing an action", () => {
  it("skips the action if another worker already moved this agent on", async () => {
    const id = await addAgent("Ada")
    onModelCall(async () => {
      await query(`UPDATE agents SET next_tick_seq = next_tick_seq + 1 WHERE id = $1`, [id])
      return textResult(ACTION)
    })

    await expect(runScheduledSlot()).resolves.toMatchObject({ ticked: 0, skipped: 1 })

    const { rows } = await query(`SELECT count(*)::int AS n FROM world_events`)
    expect(rows[0].n).toBe(0)
  })

  it("retries the commit after a concurrency conflict", async () => {
    await addAgent("Ada")
    failNext(/UPDATE agents\s+SET next_tick_seq/)

    await expect(runScheduledSlot()).resolves.toMatchObject({ ticked: 1, errors: 0 })
    expect(modelCallCount()).toBe(1)
  })

  it("charges each agent's decision to the daily budget", async () => {
    await addAgent("Ada")
    await addAgent("Bea")

    await runScheduledSlot()

    expect((await getSpendStatus()).calls).toBe(2)
  })
})
