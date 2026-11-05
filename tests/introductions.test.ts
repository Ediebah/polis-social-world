import { beforeEach, describe, expect, it, vi } from "vitest"
import { acceptIntroductionAction, askToMeetAction, declineIntroductionAction } from "@/app/actions"
import {
  askToMeet,
  countWaitingForYou,
  getIntroductions,
  introductionWith,
  MAX_ASKS_PER_DAY,
  respondToIntroduction,
} from "@/lib/introductions"
import { runScheduledSlot } from "@/lib/scheduler"
import { spawnAgent } from "./helpers/citizens"
import { failNext, query } from "./helpers/fake-db"
import { model, onModelCall, textResult } from "./helpers/fake-model"

const cookieJar = new Map<string, string>()

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
  }),
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

const spawn = (name: string) =>
  spawnAgent({
    handle: name.toLowerCase(),
    name,
    traits: ["curious", "bold", "loyal"],
    backstory: "",
    goal: "Find a good question.",
    location: "studio",
  })

const ADA_CONTACT = "ada@somewhere.example"
const BEA_CONTACT = "@bea on the usual places"

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

function at(iso: string) {
  vi.setSystemTime(new Date(iso))
}

const rows = async () => (await query(`SELECT * FROM introductions`)).rows

let ada: Awaited<ReturnType<typeof spawn>>
let bea: Awaited<ReturnType<typeof spawn>>

beforeEach(async () => {
  cookieJar.clear()
  vi.useFakeTimers({ toFake: ["Date"] })
  at("2026-11-04T10:00:00Z")
  ada = await spawn("Ada")
  bea = await spawn("Bea")
})

describe("asking to meet", () => {
  it("shows the other person a request, without either person's contact details", async () => {
    await expect(askToMeet(ada.id, bea.id, ADA_CONTACT)).resolves.toBe("asked")

    const theirs = await getIntroductions(bea.id)
    expect(theirs.incoming).toEqual([expect.objectContaining({ agentId: ada.id, name: "Ada" })])
    expect(theirs.connected).toEqual([])
    expect(JSON.stringify(theirs)).not.toContain(ADA_CONTACT)
    await expect(countWaitingForYou(bea.id)).resolves.toBe(1)
  })

  it("shows the person asking what they've offered to share", async () => {
    await askToMeet(ada.id, bea.id, ADA_CONTACT)

    const mine = await getIntroductions(ada.id)
    expect(mine.outgoing).toEqual([expect.objectContaining({ agentId: bea.id, name: "Bea", yourContact: ADA_CONTACT })])
    expect(mine.incoming).toEqual([])
    await expect(countWaitingForYou(ada.id)).resolves.toBe(0)
  })

  it("keeps the conversation it came from", async () => {
    const conversationId = crypto.randomUUID()
    await query(
      `INSERT INTO conversations (id, place, question, status, agent_turns, created_at, updated_at)
       VALUES ($1, 'studio', 'A question?', 'open', 0, now(), now())`,
      [conversationId],
    )

    await askToMeet(ada.id, bea.id, ADA_CONTACT, conversationId)

    expect((await getIntroductions(bea.id)).incoming[0].conversationId).toBe(conversationId)
  })

  it.each(["not-a-uuid", "00000000-0000-4000-8000-000000000000"])("drops a conversation that doesn't exist: %s", async (conversationId) => {
    await askToMeet(ada.id, bea.id, ADA_CONTACT, conversationId)

    expect((await getIntroductions(bea.id)).incoming[0].conversationId).toBeNull()
  })

  it("keeps contact details exactly as written, apart from the space around them", async () => {
    await askToMeet(ada.id, bea.id, `  ${ADA_CONTACT} <call me> `)

    expect((await rows())[0].requester_contact).toBe(`${ADA_CONTACT} <call me>`)
  })

  it.each([
    ["yourself", (a: string) => a, "self"],
    ["someone who doesn't exist", () => crypto.randomUUID(), "no_one"],
    ["a malformed id", () => "not-a-uuid", "no_one"],
  ])("refuses %s", async (_label, target, reason) => {
    await expect(askToMeet(ada.id, target(ada.id), ADA_CONTACT)).rejects.toMatchObject({ reason })
    expect(await rows()).toEqual([])
  })

  it("refuses a house agent, which has no person behind it", async () => {
    const house = crypto.randomUUID()
    await query(`INSERT INTO agents (id, name, status, is_house, created_at) VALUES ($1, 'Mira', 'alive', TRUE, now())`, [house])

    await expect(askToMeet(ada.id, house, ADA_CONTACT)).rejects.toMatchObject({ reason: "no_one" })
  })

  it("refuses a house agent even if it somehow has an owner token", async () => {
    const house = crypto.randomUUID()
    await query(`INSERT INTO agents (id, name, status, is_house, owner_token, created_at) VALUES ($1, 'Mira', 'alive', TRUE, $2, now())`, [
      house,
      crypto.randomUUID(),
    ])

    await expect(askToMeet(ada.id, house, ADA_CONTACT)).rejects.toMatchObject({ reason: "no_one" })
  })

  it("refuses a citizen with nobody holding its owner token", async () => {
    const nobody = crypto.randomUUID()
    await query(`INSERT INTO agents (id, name, status, created_at) VALUES ($1, 'Old Citizen', 'alive', now())`, [nobody])

    await expect(askToMeet(ada.id, nobody, ADA_CONTACT)).rejects.toMatchObject({ reason: "no_one" })
  })

  it("refuses someone whose citizen is no longer active", async () => {
    await query(`UPDATE agents SET status = 'suspended' WHERE id = $1`, [bea.id])

    await expect(askToMeet(ada.id, bea.id, ADA_CONTACT)).rejects.toMatchObject({ reason: "no_one" })
  })

  it.each([["", "contact"], ["ab", "contact"], ["x".repeat(201), "contact"]])("refuses contact details of %j", async (contact, reason) => {
    await expect(askToMeet(ada.id, bea.id, contact)).rejects.toMatchObject({ reason })
    expect(await rows()).toEqual([])
  })

  it("asks only once, and doesn't change what was offered", async () => {
    await askToMeet(ada.id, bea.id, ADA_CONTACT)
    at("2026-11-04T10:05:00Z")

    await expect(askToMeet(ada.id, bea.id, "something else")).rejects.toMatchObject({ reason: "already" })

    const all = await rows()
    expect(all).toHaveLength(1)
    expect(all[0].requester_contact).toBe(ADA_CONTACT)
  })

  it("makes people wait between asks", async () => {
    const cal = await spawn("Cal")
    await askToMeet(ada.id, bea.id, ADA_CONTACT)

    await expect(askToMeet(ada.id, cal.id, ADA_CONTACT)).rejects.toMatchObject({ reason: "slow_down" })

    at("2026-11-04T10:00:31Z")
    await expect(askToMeet(ada.id, cal.id, ADA_CONTACT)).resolves.toBe("asked")
  })

  it("limits asks in a day, and allows more the next day", async () => {
    const others = await Promise.all(Array.from({ length: MAX_ASKS_PER_DAY + 1 }, (_, i) => spawn(`Citizen${i}`)))
    for (const [i, other] of others.slice(0, MAX_ASKS_PER_DAY).entries()) {
      at(`2026-11-04T1${i}:00:00Z`)
      await askToMeet(ada.id, other.id, ADA_CONTACT)
    }

    at("2026-11-04T20:00:00Z")
    await expect(askToMeet(ada.id, others[MAX_ASKS_PER_DAY].id, ADA_CONTACT)).rejects.toMatchObject({ reason: "limit" })

    at("2026-11-05T19:00:00Z")
    await expect(askToMeet(ada.id, others[MAX_ASKS_PER_DAY].id, ADA_CONTACT)).resolves.toBe("asked")
  })

  it("retries after a concurrency conflict", async () => {
    failNext(/INSERT INTO introductions/)

    await expect(askToMeet(ada.id, bea.id, ADA_CONTACT)).resolves.toBe("asked")
    expect(await rows()).toHaveLength(1)
  })
})

describe("answering", () => {
  beforeEach(() => askToMeet(ada.id, bea.id, ADA_CONTACT))

  it("shows both people the details each chose once both have accepted", async () => {
    await respondToIntroduction(bea.id, ada.id, true, BEA_CONTACT)

    const hers = await getIntroductions(ada.id)
    const theirs = await getIntroductions(bea.id)
    expect(hers.connected).toEqual([expect.objectContaining({ agentId: bea.id, theirContact: BEA_CONTACT, yourContact: ADA_CONTACT })])
    expect(theirs.connected).toEqual([expect.objectContaining({ agentId: ada.id, theirContact: ADA_CONTACT, yourContact: BEA_CONTACT })])
    expect(hers.outgoing).toEqual([])
    expect(theirs.incoming).toEqual([])
    await expect(countWaitingForYou(bea.id)).resolves.toBe(0)
  })

  it("needs contact details to accept", async () => {
    await expect(respondToIntroduction(bea.id, ada.id, true, " ")).rejects.toMatchObject({ reason: "contact" })

    expect((await getIntroductions(ada.id)).connected).toEqual([])
  })

  it("won't let the person who asked accept their own request", async () => {
    await expect(respondToIntroduction(ada.id, bea.id, true, ADA_CONTACT)).rejects.toMatchObject({ reason: "gone" })

    expect((await rows())[0].status).toBe("pending")
  })

  it("won't let a third person answer", async () => {
    const cal = await spawn("Cal")

    await expect(respondToIntroduction(cal.id, ada.id, true, "cal@example.com")).rejects.toMatchObject({ reason: "gone" })
    await expect(respondToIntroduction(cal.id, bea.id, true, "cal@example.com")).rejects.toMatchObject({ reason: "gone" })

    expect((await rows())[0].status).toBe("pending")
  })

  it("never tells the person who asked that they were turned down", async () => {
    const before = await getIntroductions(ada.id)

    await respondToIntroduction(bea.id, ada.id, false)

    await expect(getIntroductions(ada.id)).resolves.toEqual(before)
    await expect(introductionWith(ada.id, bea.id)).resolves.toBe("asked")
    expect((await getIntroductions(bea.id)).incoming).toEqual([])
    await expect(countWaitingForYou(bea.id)).resolves.toBe(0)
  })

  it("doesn't let someone who was turned down ask again", async () => {
    await respondToIntroduction(bea.id, ada.id, false)
    at("2026-11-05T10:00:00Z")

    await expect(askToMeet(ada.id, bea.id, ADA_CONTACT)).rejects.toMatchObject({ reason: "already" })
  })

  it("isn't fooled by the same id in capitals", async () => {
    await respondToIntroduction(bea.id, ada.id, false)
    at("2026-11-05T10:00:00Z")

    await expect(askToMeet(ada.id, bea.id.toUpperCase(), ADA_CONTACT)).rejects.toMatchObject({ reason: "already" })
    await expect(askToMeet(ada.id, ada.id.toUpperCase(), ADA_CONTACT)).rejects.toMatchObject({ reason: "self" })

    expect(await rows()).toHaveLength(1)
    await expect(introductionWith(ada.id, bea.id.toUpperCase())).resolves.toBe("asked")
    await expect(countWaitingForYou(bea.id)).resolves.toBe(0)
  })

  it("lets the person who said no change their mind by asking", async () => {
    await respondToIntroduction(bea.id, ada.id, false)
    at("2026-11-05T10:00:00Z")

    await expect(askToMeet(bea.id, ada.id, BEA_CONTACT)).resolves.toBe("connected")

    expect((await getIntroductions(ada.id)).connected[0].theirContact).toBe(BEA_CONTACT)
  })

  it("connects people who ask each other", async () => {
    at("2026-11-04T10:05:00Z")

    await expect(askToMeet(bea.id, ada.id, BEA_CONTACT)).resolves.toBe("connected")

    expect((await getIntroductions(bea.id)).connected[0].theirContact).toBe(ADA_CONTACT)
    expect(await rows()).toHaveLength(1)
  })

  it("can only be accepted once", async () => {
    await respondToIntroduction(bea.id, ada.id, true, BEA_CONTACT)

    await expect(respondToIntroduction(bea.id, ada.id, true, "changed")).rejects.toMatchObject({ reason: "gone" })
    await expect(askToMeet(bea.id, ada.id, "changed")).rejects.toMatchObject({ reason: "already" })
    expect((await rows())[0].recipient_contact).toBe(BEA_CONTACT)
  })

  it.each(["the other person", "the person who asked"])("hides a connection once %s is no longer active", async (who) => {
    await respondToIntroduction(bea.id, ada.id, true, BEA_CONTACT)
    const [gone, here] = who === "the other person" ? [bea.id, ada.id] : [ada.id, bea.id]
    await query(`UPDATE agents SET status = 'suspended' WHERE id = $1`, [gone])

    expect((await getIntroductions(here)).connected).toEqual([])
  })

  it("stops waiting on someone who's no longer active", async () => {
    await query(`UPDATE agents SET status = 'suspended' WHERE id = $1`, [ada.id])

    expect((await getIntroductions(bea.id)).incoming).toEqual([])
    await expect(countWaitingForYou(bea.id)).resolves.toBe(0)
  })

  it("shows the person who said no that the question is closed for them", async () => {
    await respondToIntroduction(bea.id, ada.id, false)

    await expect(introductionWith(bea.id, ada.id)).resolves.toBe("none")
  })

  it("treats a malformed id as nothing to answer", async () => {
    await expect(respondToIntroduction(bea.id, "not-a-uuid", true, BEA_CONTACT)).rejects.toMatchObject({ reason: "gone" })
    await expect(introductionWith(bea.id, "not-a-uuid")).resolves.toBe("none")
  })

  it("reports where a pair stands, from either side", async () => {
    await expect(introductionWith(ada.id, bea.id)).resolves.toBe("asked")
    await expect(introductionWith(bea.id, ada.id)).resolves.toBe("incoming")

    await respondToIntroduction(bea.id, ada.id, true, BEA_CONTACT)

    await expect(introductionWith(ada.id, bea.id)).resolves.toBe("connected")
    await expect(introductionWith(bea.id, ada.id)).resolves.toBe("connected")
    const cal = await spawn("Cal")
    await expect(introductionWith(ada.id, cal.id)).resolves.toBe("none")
  })
})

describe("what stays out of agents' hands", () => {
  it("never puts contact details in a prompt", async () => {
    await askToMeet(ada.id, bea.id, ADA_CONTACT)
    await respondToIntroduction(bea.id, ada.id, true, BEA_CONTACT)
    onModelCall(async () =>
      textResult(JSON.stringify({ type: "move", text: "a thought", to: "commons", idea_ref: null, conversation_ref: null, kind: null, takeaway: null, memory_ref: null })),
    )

    await runScheduledSlot()

    const prompts = JSON.stringify(model.doGenerateCalls.map((c) => c.prompt))
    expect(prompts.length).toBeGreaterThan(100)
    expect(prompts).not.toContain(ADA_CONTACT)
    expect(prompts).not.toContain(BEA_CONTACT)
  })
})

describe("the buttons", () => {
  const signIn = (citizen: { id: string; ownerToken: string }) => cookieJar.set(`polis-own-${citizen.id}`, citizen.ownerToken)

  it("asks as whoever this browser is, whatever the form claims", async () => {
    signIn(ada)
    const cal = await spawn("Cal")

    const state = await askToMeetAction({}, form({ agentId: cal.id, requesterId: bea.id, contact: ADA_CONTACT }))

    expect(state.done).toBe("asked")
    expect((await rows())[0].requester_id).toBe(ada.id)
  })

  it("refuses a visitor", async () => {
    const state = await askToMeetAction({}, form({ agentId: bea.id, contact: ADA_CONTACT }))

    expect(state.error).toBeTruthy()
    expect(await rows()).toEqual([])
  })

  it("refuses the owner of a citizen that's no longer active", async () => {
    signIn(ada)
    await query(`UPDATE agents SET status = 'suspended' WHERE id = $1`, [ada.id])

    expect((await askToMeetAction({}, form({ agentId: bea.id, contact: ADA_CONTACT }))).error).toBeTruthy()
    expect(await rows()).toEqual([])
  })

  it("hands back what was typed when it's refused", async () => {
    signIn(ada)

    const state = await askToMeetAction({}, form({ agentId: ada.id, contact: ADA_CONTACT }))

    expect(state.error).toBeTruthy()
    expect(state.contact).toBe(ADA_CONTACT)
  })

  it("accepts and declines only as whoever this browser is", async () => {
    await askToMeet(ada.id, bea.id, ADA_CONTACT)
    const cal = await spawn("Cal")
    signIn(cal)

    const accepted = await acceptIntroductionAction({}, form({ agentId: ada.id, contact: "cal@example.com" }))
    await declineIntroductionAction(form({ agentId: ada.id }))

    expect(accepted.error).toBeTruthy()
    expect((await rows())[0].status).toBe("pending")
  })

  it("refuses a visitor who tries to answer", async () => {
    await askToMeet(ada.id, bea.id, ADA_CONTACT)

    const accepted = await acceptIntroductionAction({}, form({ agentId: ada.id, contact: "visitor@example.com" }))
    await declineIntroductionAction(form({ agentId: ada.id }))

    expect(accepted.error).toBeTruthy()
    expect(accepted.contact).toBe("visitor@example.com")
    expect((await rows())[0].status).toBe("pending")
  })

  it("accepts for the person it was sent to", async () => {
    await askToMeet(ada.id, bea.id, ADA_CONTACT)
    signIn(bea)

    await expect(acceptIntroductionAction({}, form({ agentId: ada.id, contact: BEA_CONTACT }))).resolves.toEqual({ done: "connected" })

    expect((await rows())[0].status).toBe("accepted")
  })

  it("declines for the person it was sent to", async () => {
    await askToMeet(ada.id, bea.id, ADA_CONTACT)
    signIn(bea)

    await declineIntroductionAction(form({ agentId: ada.id }))

    expect((await rows())[0].status).toBe("declined")
  })
})
