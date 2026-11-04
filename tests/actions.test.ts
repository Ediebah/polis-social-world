import { beforeEach, describe, expect, it, vi } from "vitest"
import { addWordsAction, nudgeAction, shareIdeaAction } from "@/app/actions"
import { spawnAgent } from "./helpers/citizens"
import { query } from "./helpers/fake-db"

const cookieJar = new Map<string, string>()

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined) }),
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

const spawn = (name = "Ada") =>
  spawnAgent({
    handle: name.toLowerCase(),
    name,
    traits: ["curious", "bold", "loyal"],
    backstory: "A long enough backstory.",
    goal: "Find a good question.",
    location: "studio",
  })

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

async function conversation(status = "open") {
  const id = crypto.randomUUID()
  await query(
    `INSERT INTO conversations (id, place, question, status, agent_turns, created_at, updated_at)
     VALUES ($1, 'studio', 'What should we ask?', $2, 0, now(), now())`,
    [id, status],
  )
  return id
}

const count = async (table: string) => (await query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number

beforeEach(() => cookieJar.clear())

describe("adding your words", () => {
  it("works for the citizen's owner", async () => {
    const { id, ownerToken } = await spawn()
    const conversationId = await conversation()
    cookieJar.set(`polis-own-${id}`, ownerToken)

    const state = await addWordsAction({}, form({ agentId: id, conversationId, text: "My own words." }))

    expect(state).toEqual({ ok: true })
    expect(await count("contributions")).toBe(1)
  })

  it("refuses someone with no owner cookie", async () => {
    const { id } = await spawn()
    const conversationId = await conversation()

    const state = await addWordsAction({}, form({ agentId: id, conversationId, text: "Impersonating." }))

    expect(state.error).toBeTruthy()
    expect(await count("contributions")).toBe(0)
  })

  it("refuses the owner of a different citizen posting as this one", async () => {
    const victim = await spawn("Ada")
    const attacker = await spawn("Bea")
    const conversationId = await conversation()
    cookieJar.set(`polis-own-${attacker.id}`, attacker.ownerToken)
    cookieJar.set(`polis-own-${victim.id}`, attacker.ownerToken)

    const state = await addWordsAction({}, form({ agentId: victim.id, conversationId, text: "Impersonating." }))

    expect(state.error).toBeTruthy()
    expect(await count("contributions")).toBe(0)
  })

  it("explains why a post was refused", async () => {
    const { id, ownerToken } = await spawn()
    const conversationId = await conversation("closed")
    cookieJar.set(`polis-own-${id}`, ownerToken)

    const state = await addWordsAction({}, form({ agentId: id, conversationId, text: "Too late." }))

    expect(state.error).toMatch(/closed/i)
  })

  it("gives the words back when a post is refused, so nobody loses what they wrote", async () => {
    const { id, ownerToken } = await spawn()
    const conversationId = await conversation("closed")
    cookieJar.set(`polis-own-${id}`, ownerToken)
    const words = "  Something I took a while to write.\n"

    const state = await addWordsAction({}, form({ agentId: id, conversationId, text: words }))

    expect(state.text).toBe(words)
  })
})

describe("nudging", () => {
  async function nudge(id: string, goal: string) {
    await nudgeAction(form({ agentId: id, goal }))
    const goalNow = await query(`SELECT goal FROM agents WHERE id = $1`, [id])
    const events = await query(`SELECT count(*)::int AS n FROM world_events WHERE agent_id = $1 AND kind = 'post'`, [id])
    return { goal: goalNow.rows[0].goal, events: events.rows[0].n }
  }

  it("works for the owner, and can't flood the feed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-03T10:00:00Z"))
    const { id, ownerToken } = await spawn()
    cookieJar.set(`polis-own-${id}`, ownerToken)

    await expect(nudge(id, "A first new goal.")).resolves.toEqual({ goal: "A first new goal.", events: 1 })
    vi.setSystemTime(new Date("2026-11-03T10:00:20Z"))
    await expect(nudge(id, "A second new goal.")).resolves.toEqual({ goal: "A first new goal.", events: 1 })
    vi.setSystemTime(new Date("2026-11-03T10:00:31Z"))
    await expect(nudge(id, "A third new goal.")).resolves.toEqual({ goal: "A third new goal.", events: 2 })
  })

  it("does nothing for anyone else", async () => {
    const { id } = await spawn()

    await expect(nudge(id, "A hijacked goal.")).resolves.toEqual({ goal: "Find a good question.", events: 0 })
  })
})

describe("sharing an idea", () => {
  it("works for the citizen's owner", async () => {
    const { id, ownerToken } = await spawn()
    cookieJar.set(`polis-own-${id}`, ownerToken)

    const state = await shareIdeaAction({}, form({ agentId: id, place: "studio", text: "Libraries should lend tools." }))

    expect(state).toEqual({ ok: true })
    expect(await count("ideas")).toBe(1)
  })

  it("refuses someone with no owner cookie", async () => {
    const { id } = await spawn()

    const state = await shareIdeaAction({}, form({ agentId: id, place: "studio", text: "Libraries should lend tools." }))

    expect(state.error).toBeTruthy()
    expect(await count("ideas")).toBe(0)
  })

  it("explains why an idea was refused", async () => {
    const { id, ownerToken } = await spawn()
    cookieJar.set(`polis-own-${id}`, ownerToken)

    const state = await shareIdeaAction({}, form({ agentId: id, place: "studio", text: "short" }))

    expect(state.error).toMatch(/short/i)
  })

  it("explains when a citizen has shared all it can today", async () => {
    const { id, ownerToken } = await spawn()
    cookieJar.set(`polis-own-${id}`, ownerToken)
    await query(
      `INSERT INTO ideas (id, agent_id, place, text, created_at)
       SELECT gen_random_uuid(), $1, 'studio', 'An earlier idea.', now() FROM generate_series(1, 3)`,
      [id],
    )

    const state = await shareIdeaAction({}, form({ agentId: id, place: "studio", text: "Libraries should lend tools." }))

    expect(state.error).toMatch(/today/i)
  })

  it("gives the idea back when it's refused, and picks the same place", async () => {
    const { id, ownerToken } = await spawn()
    cookieJar.set(`polis-own-${id}`, ownerToken)

    const state = await shareIdeaAction({}, form({ agentId: id, place: "commons", text: "short" }))

    expect(state).toMatchObject({ text: "short", place: "commons" })
  })
})
