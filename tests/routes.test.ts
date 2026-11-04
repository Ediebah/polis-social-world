import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST as ask } from "@/app/api/ask/[id]/route"
import * as tickRoute from "@/app/api/tick/route"
import { GET as control, POST as setControl } from "@/app/api/admin/control/route"
import { GET as feed } from "@/app/api/feed/route"
import { GET as journal } from "@/app/api/journal/[id]/route"
import { GET as setup } from "@/app/api/setup/route"
import { POST as speak } from "@/app/api/speak/route"
import { POST as transcribe } from "@/app/api/transcribe/route"
import { spawnAgent } from "@/lib/queries"
import { getSpendStatus, setPaused } from "@/lib/spend"
import { failNext, query } from "./helpers/fake-db"
import { model, modelCallCount, onModelCall, textResult } from "./helpers/fake-model"

const CRON_SECRET = "cron-secret-for-tests"
const ADMIN_SECRET = "admin-secret-for-tests"
const ACTION = JSON.stringify({ type: "post", text: "a thought", to: null, item: null, price: null, with_agent: null })

function bearer(url: string, secret?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (secret !== undefined) headers.set("authorization", `Bearer ${secret}`)
  return new Request(`http://polis.test${url}`, { ...init, headers })
}

function newAgent(name = "Ada") {
  return spawnAgent({
    handle: name.toLowerCase(),
    name,
    traits: ["curious", "bold", "loyal"],
    backstory: "A long enough backstory.",
    goal: "Find a good question.",
    location: "plaza",
  })
}

async function agentCount() {
  const { rows } = await query(`SELECT count(*)::int AS n FROM agents`)
  return rows[0].n
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON_SECRET)
  vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET)
})

describe("GET /api/feed", () => {
  it("does not advance the world or spend anything when polled", async () => {
    await newAgent()
    onModelCall(async () => textResult(ACTION))

    const res = await feed()
    await new Promise((r) => setTimeout(r, 50))

    expect(res.status).toBe(200)
    expect(modelCallCount()).toBe(0)
    expect((await getSpendStatus()).calls).toBe(0)
  })

  it("reports when the world last changed", async () => {
    await newAgent()
    onModelCall(async () => textResult(ACTION))
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-02T10:01:00Z"))
    await tickRoute.GET(bearer("/api/tick", CRON_SECRET))

    const body = await (await feed()).json()

    expect(body.lastUpdateAt).toBe("2026-11-02T10:01:00.000Z")
  })

  it("still serves the feed if the run history can't be read", async () => {
    await newAgent()
    failNext(/FROM tick_runs/, "42P01")

    const res = await feed()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.feed).toHaveLength(1)
    expect(body.lastUpdateAt).toBeNull()
  })
})

describe("/api/tick", () => {
  it("offers no public way to trigger a run", () => {
    expect(Object.keys(tickRoute)).not.toContain("POST")
  })

  it.each([
    ["no secret", undefined],
    ["the wrong secret", "nope"],
    ["the admin secret", ADMIN_SECRET],
  ])("rejects %s without running anything", async (_label, secret) => {
    await newAgent()

    const res = await tickRoute.GET(bearer("/api/tick", secret))

    expect(res.status).toBe(401)
    expect(modelCallCount()).toBe(0)
  })

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("rejects everyone when CRON_SECRET is %s", async (_label, value) => {
    vi.stubEnv("CRON_SECRET", value)
    await newAgent()

    for (const secret of [undefined, "", "undefined"]) {
      const res = await tickRoute.GET(bearer("/api/tick", secret))
      expect(res.status).toBe(401)
    }
    expect(modelCallCount()).toBe(0)
  })

  it("runs the current slot once for an authorized trigger", async () => {
    await newAgent()
    onModelCall(async () => textResult(ACTION))
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-02T10:01:00Z"))

    const first = await (await tickRoute.GET(bearer("/api/tick", CRON_SECRET))).json()
    const second = await (await tickRoute.GET(bearer("/api/tick", CRON_SECRET))).json()

    expect(first).toMatchObject({ ok: true, status: "ran", ticked: 1 })
    expect(second).toMatchObject({ ok: true, status: "slot-taken" })
    expect(modelCallCount()).toBe(1)
  })

  it("reports a failed run as a server error", async () => {
    failNext(/INSERT INTO tick_runs/, "XX000")

    const res = await tickRoute.GET(bearer("/api/tick", CRON_SECRET))

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false })
  })

  it("leaves enough time for a run to finish", () => {
    expect(tickRoute.maxDuration).toBeGreaterThanOrEqual(120)
  })
})

describe("GET /api/setup", () => {
  it.each([
    ["no secret", undefined],
    ["the cron secret", CRON_SECRET],
  ])("rejects %s without seeding", async (_label, secret) => {
    const res = await setup(bearer("/api/setup", secret))

    expect(res.status).toBe(401)
    expect(await agentCount()).toBe(0)
  })

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("rejects everyone when ADMIN_SECRET is %s", async (_label, value) => {
    vi.stubEnv("ADMIN_SECRET", value)

    for (const secret of [undefined, "", "undefined"]) {
      const res = await setup(bearer("/api/setup", secret))
      expect(res.status).toBe(401)
    }
    expect(await agentCount()).toBe(0)
  })

  it("seeds the city once for an authorized caller", async () => {
    const first = await (await setup(bearer("/api/setup", ADMIN_SECRET))).json()
    const second = await (await setup(bearer("/api/setup", ADMIN_SECRET))).json()

    expect(first).toMatchObject({ ok: true, seeded: "seeded" })
    expect(second).toMatchObject({ ok: true, seeded: "already-seeded" })
    expect(await agentCount()).toBe(6)
  })
})

describe("/api/admin/control", () => {
  const post = (secret: string | undefined, body: unknown) =>
    setControl(bearer("/api/admin/control", secret, { method: "POST", body: JSON.stringify(body) }))

  it.each([
    ["no secret", undefined],
    ["the cron secret", CRON_SECRET],
  ])("rejects %s", async (_label, secret) => {
    expect((await control(bearer("/api/admin/control", secret))).status).toBe(401)
    expect((await post(secret, { paused: true })).status).toBe(401)
    expect((await getSpendStatus()).paused).toBe(false)
  })

  it("pauses and resumes the city", async () => {
    await newAgent()

    const paused = await (await post(ADMIN_SECRET, { paused: true })).json()
    const whilePaused = await (await tickRoute.GET(bearer("/api/tick", CRON_SECRET))).json()
    const resumed = await (await post(ADMIN_SECRET, { paused: false })).json()

    expect(paused).toMatchObject({ ok: true, paused: true })
    expect(whilePaused).toMatchObject({ ok: true, status: "paused" })
    expect(resumed).toMatchObject({ ok: true, paused: false })
  })

  it.each([[{ paused: "yes" }], [{}], ["true"]])("ignores a malformed request: %j", async (body) => {
    const res = await post(ADMIN_SECRET, body)

    expect(res.status).toBe(400)
    expect((await getSpendStatus()).paused).toBe(false)
  })

  it("reports today's estimated spend, the cap, and the last update", async () => {
    vi.stubEnv("DAILY_SPEND_CAP_USD", "3")
    await newAgent()
    onModelCall(async () => textResult(ACTION))
    await tickRoute.GET(bearer("/api/tick", CRON_SECRET))

    const body = await (await control(bearer("/api/admin/control", ADMIN_SECRET))).json()

    expect(body).toMatchObject({ ok: true, capUsd: 3, calls: 1, paused: false })
    expect(body.estimatedSpendUsd).toBeCloseTo(0.0002, 9)
    expect(body.lastUpdateAt).toEqual(expect.any(String))
  })
})

describe("POST /api/ask/[id]", () => {
  function askAs(id: string, cookie?: string, question = "What did you do today?") {
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (cookie) headers.cookie = cookie
    const req = new NextRequest(`http://polis.test/api/ask/${id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ question }),
    })
    return ask(req, { params: Promise.resolve({ id }) })
  }
  const ownerCookie = (id: string, token: string) => `polis-own-${id}=${token}`

  it("answers the citizen's owner and charges the budget", async () => {
    const { id, ownerToken } = await newAgent()
    onModelCall(async () => textResult("I wandered the plaza."))

    const res = await askAs(id, ownerCookie(id, ownerToken))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ answer: "I wandered the plaza." })
    expect((await getSpendStatus()).calls).toBe(1)
    expect(model.doGenerateCalls[0].maxOutputTokens).toBeLessThanOrEqual(300)
  })

  it("rejects non-owners without calling the model", async () => {
    const { id } = await newAgent("Ada")
    const other = await newAgent("Bea")

    const cases = [
      undefined,
      ownerCookie(id, crypto.randomUUID()),
      ownerCookie(id, other.ownerToken),
      ownerCookie(other.id, other.ownerToken),
      ownerCookie(id, "not-a-uuid"),
    ]
    for (const cookie of cases) {
      const res = await askAs(id, cookie)
      expect(res.status).toBe(403)
    }
    expect(modelCallCount()).toBe(0)
  })

  it("rejects a malformed citizen id without an error", async () => {
    const { ownerToken } = await newAgent()

    const res = await askAs("not-a-uuid", ownerCookie("not-a-uuid", ownerToken))

    expect(res.status).toBe(403)
  })

  it("makes the owner wait between questions", async () => {
    const { id, ownerToken } = await newAgent()
    const cookie = ownerCookie(id, ownerToken)
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-02T10:00:00Z"))

    expect((await askAs(id, cookie)).status).toBe(200)

    vi.setSystemTime(new Date("2026-11-02T10:00:14Z"))
    expect((await askAs(id, cookie)).status).toBe(429)
    expect(modelCallCount()).toBe(1)

    vi.setSystemTime(new Date("2026-11-02T10:00:16Z"))
    expect((await askAs(id, cookie)).status).toBe(200)
    expect(modelCallCount()).toBe(2)
  })

  it("doesn't start the wait for an empty question", async () => {
    const { id, ownerToken } = await newAgent()
    const cookie = ownerCookie(id, ownerToken)

    expect(await (await askAs(id, cookie, "   ")).json()).toEqual({ answer: "" })
    expect((await askAs(id, cookie)).status).toBe(200)
  })

  it("says so when the city is paused or over budget", async () => {
    const { id, ownerToken } = await newAgent("Ada")
    const other = await newAgent("Bea")
    await setPaused(true)

    const paused = await askAs(id, ownerCookie(id, ownerToken))
    expect(paused.status).toBe(503)
    expect(await paused.json()).toEqual({ answer: "", error: "paused" })

    await setPaused(false)
    vi.stubEnv("DAILY_SPEND_CAP_USD", "0")

    const overBudget = await askAs(other.id, ownerCookie(other.id, other.ownerToken))
    expect(overBudget.status).toBe(503)
    expect(await overBudget.json()).toEqual({ answer: "", error: "cap" })
    expect(modelCallCount()).toBe(0)
  })
})

describe("GET /api/journal/[id]", () => {
  const read = (id: string) =>
    journal(new Request(`http://polis.test/api/journal/${id}`), { params: Promise.resolve({ id }) })

  it("writes the entry through the budget", async () => {
    const { id } = await newAgent()
    onModelCall(async () => textResult("I arrived in the plaza."))

    const body = await (await read(id)).json()

    expect(body.journal).toBe("I arrived in the plaza.")
    expect((await getSpendStatus()).calls).toBe(1)
    expect(model.doGenerateCalls[0].maxOutputTokens).toBeLessThanOrEqual(300)
  })

  it("serves a plain summary while paused, and writes again after resuming", async () => {
    const { id } = await newAgent()
    await setPaused(true)

    const whilePaused = await (await read(id)).json()

    expect(whilePaused.journal).toBe("Arrived in the plaza.")
    expect(modelCallCount()).toBe(0)

    await setPaused(false)
    onModelCall(async () => textResult("A proper entry."))
    expect((await (await read(id)).json()).journal).toBe("A proper entry.")
  })

  async function addEvent(agentId: string, at = new Date().toISOString()) {
    await query(
      `INSERT INTO world_events (id, agent_id, kind, payload, location, created_at)
       VALUES ($1, $2, 'post', '{"text":"a new thought"}'::jsonb, 'plaza', $3)`,
      [crypto.randomUUID(), agentId, at],
    )
  }

  it("doesn't spend again on later views when the citizen has done nothing new", async () => {
    const { id } = await newAgent()
    onModelCall(async () => textResult("An entry worth keeping."))
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-02T10:00:00Z"))

    await read(id)
    vi.setSystemTime(new Date("2026-11-02T16:00:00Z"))
    const later = await (await read(id)).json()

    expect(later.journal).toBe("An entry worth keeping.")
    expect(modelCallCount()).toBe(1)
    expect((await getSpendStatus()).calls).toBe(1)
  })

  it("writes a new entry once the citizen has done something new", async () => {
    const { id } = await newAgent()
    onModelCall(async () => textResult(`Entry ${modelCallCount()}.`))

    await read(id)
    await addEvent(id, new Date(Date.now() + 1000).toISOString())
    const body = await (await read(id)).json()

    expect(body.journal).toBe("Entry 2.")
    expect(modelCallCount()).toBe(2)
  })

  it("makes one call when many people open a citizen at once", async () => {
    const { id } = await newAgent()
    onModelCall(async () => textResult("Written once."))

    const responses = await Promise.all(Array.from({ length: 8 }, () => read(id)))

    expect(responses.every((r) => r.status === 200)).toBe(true)
    expect(modelCallCount()).toBe(1)
  })

  it("tries again on the next visit when the call fails", async () => {
    const { id } = await newAgent()
    onModelCall(async () => {
      throw new Error("provider down")
    })

    const failed = await (await read(id)).json()
    onModelCall(async () => textResult("Back to normal."))
    const next = await (await read(id)).json()

    expect(failed.journal).toBe("Arrived in the plaza.")
    expect(next.journal).toBe("Back to normal.")
  })

  it("keeps the newer entry when a slower writer finishes after it", async () => {
    const { id } = await newAgent()
    onModelCall(async () => {
      if (modelCallCount() > 1) return textResult("Newer entry.")
      await addEvent(id, new Date(Date.now() + 1000).toISOString())
      await read(id)
      return textResult("Older entry.")
    })

    await read(id)
    const body = await (await read(id)).json()

    expect(body.journal).toBe("Newer entry.")
    expect(modelCallCount()).toBe(2)
  })

  it("stops at the visitors' share of the budget, leaving the rest for world updates", async () => {
    const { id } = await newAgent()
    onModelCall(async () => textResult("Should not be written."))
    vi.stubEnv("DAILY_SPEND_CAP_USD", "1")
    const day = new Date().toISOString().slice(0, 10)
    await query(`INSERT INTO spend_days (day, reserved_micros, calls, updated_at) VALUES ($1, 600000, 0, $2)`, [
      day,
      new Date().toISOString(),
    ])

    const body = await (await read(id)).json()

    expect(body.journal).toBe("Arrived in the plaza.")
    expect(modelCallCount()).toBe(0)
  })

  it("shows the plain summary without spending when saved entries can't be reached", async () => {
    const { id } = await newAgent()
    onModelCall(async () => textResult("Should not be written."))
    failNext(/agent_journals/, "42P01", 5)

    const res = await read(id)

    expect((await res.json()).journal).toBe("Arrived in the plaza.")
    expect(modelCallCount()).toBe(0)
  })

  it("doesn't use more of the budget on repeat views", async () => {
    const { id } = await newAgent()

    await read(id)
    await read(id)

    expect(modelCallCount()).toBe(1)
  })
})

describe("voice", () => {
  const speakReq = () =>
    new Request("http://polis.test/api/speak", {
      method: "POST",
      body: JSON.stringify({ text: "hello", id: "seed" }),
    })
  const transcribeReq = () =>
    new Request("http://polis.test/api/transcribe", { method: "POST", body: new Uint8Array(4000) })

  it("is off unless explicitly enabled", async () => {
    expect((await speak(speakReq())).status).toBe(503)
    expect((await transcribe(transcribeReq())).status).toBe(503)
  })

  it("stays off for any value other than 1", async () => {
    vi.stubEnv("VOICE_ENABLED", "true")

    expect((await speak(speakReq())).status).toBe(503)
    expect((await transcribe(transcribeReq())).status).toBe(503)
  })
})
