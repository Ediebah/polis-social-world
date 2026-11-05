import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST as postQuestion } from "@/app/api/admin/questions/route"
import { getBriefing, getTodaysQuestion } from "@/lib/briefing"
import {
  addOwnerWords,
  getAgentsMet,
  getFollowedConversations,
  getFollowedPlaces,
  getOwnIdeas,
  listOpenConversations,
} from "@/lib/conversations"
import { askToMeet } from "@/lib/introductions"
import { spawnAgent } from "./helpers/citizens"
import { query } from "./helpers/fake-db"

function at(iso: string) {
  vi.setSystemTime(new Date(iso))
}

const spawn = (name: string) =>
  spawnAgent({ handle: name.toLowerCase(), name, traits: ["curious", "bold", "loyal"], backstory: "", goal: "A goal.", location: "studio" })

async function conversation(fields: Partial<{ place: string; question: string | null; status: string; ideaId: string; openedBy: string; createdAt: string }> = {}) {
  const id = crypto.randomUUID()
  await query(
    `INSERT INTO conversations (id, idea_id, place, question, opened_by, status, agent_turns, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $7)`,
    [id, fields.ideaId ?? null, fields.place ?? "studio", fields.question === undefined ? "What should we ask?" : fields.question, fields.openedBy ?? null, fields.status ?? "open", fields.createdAt ?? new Date().toISOString()],
  )
  return id
}

async function contribution(conversationId: string, agentId: string, text: string, fields: Partial<{ kind: string; move: string; createdAt: string }> = {}) {
  const id = crypto.randomUUID()
  await query(
    `INSERT INTO contributions (id, conversation_id, agent_id, author_kind, move, text, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, conversationId, agentId, fields.kind ?? "agent", fields.move ?? "question", text, fields.createdAt ?? new Date().toISOString()],
  )
  return id
}

const follow = (agentId: string, conversationId: string) =>
  query(`INSERT INTO follows (agent_id, conversation_id, created_at) VALUES ($1, $2, now())`, [agentId, conversationId])

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  at("2026-11-04T10:00:00Z")
})

describe("the briefing", () => {
  it("says nothing rather than making something up", async () => {
    const { id } = await spawn("Ada")

    await expect(getBriefing(id)).resolves.toMatchObject({ items: [], takeaways: [], waitingForYou: [] })
  })

  it("links each item to the real contribution it describes, with its exact words", async () => {
    const ada = await spawn("Ada")
    const bea = await spawn("Bea")
    const conversationId = await conversation()
    await follow(ada.id, conversationId)
    const words = 'What would *change* your mind — "really"?'
    const contributionId = await contribution(conversationId, bea.id, words)

    const { items } = await getBriefing(ada.id)

    expect(items).toEqual([
      expect.objectContaining({ id: contributionId, conversation_id: conversationId, agent_id: bea.id, agent_name: "Bea", author_kind: "agent", text: words, place: "studio" }),
    ])
  })

  it("only covers conversations this person follows, whatever anyone else follows", async () => {
    const ada = await spawn("Ada")
    const bea = await spawn("Bea")
    const hers = await conversation()
    await follow(bea.id, hers)
    await contribution(hers, bea.id, "Somewhere else.")

    await expect(getBriefing(ada.id)).resolves.toMatchObject({ items: [] })
  })

  it("leaves out this person's own words, which they already know", async () => {
    const ada = await spawn("Ada")
    const conversationId = await conversation()
    await follow(ada.id, conversationId)
    await contribution(conversationId, ada.id, "My own words.", { kind: "owner", move: "" })
    const agentWords = await contribution(conversationId, ada.id, "What my agent said.")

    const { items } = await getBriefing(ada.id)

    expect(items.map((i) => i.id)).toEqual([agentWords])
  })

  it("marks another person's words as theirs", async () => {
    const ada = await spawn("Ada")
    const bea = await spawn("Bea")
    const conversationId = await conversation()
    await follow(ada.id, conversationId)
    await contribution(conversationId, bea.id, "Bea's owner speaking.", { kind: "owner" })

    expect((await getBriefing(ada.id)).items[0].author_kind).toBe("owner")
  })

  it("covers the last week", async () => {
    const ada = await spawn("Ada")
    const bea = await spawn("Bea")
    const conversationId = await conversation()
    await follow(ada.id, conversationId)
    await contribution(conversationId, bea.id, "Too old.", { createdAt: "2026-10-28T09:00:00Z" })
    await contribution(conversationId, bea.id, "Just in time.", { createdAt: "2026-10-28T11:00:00Z" })

    const { items } = await getBriefing(ada.id)

    expect(items.map((i) => i.text)).toEqual(["Just in time."])
  })

  it("puts the newest first, and stays short", async () => {
    const ada = await spawn("Ada")
    const bea = await spawn("Bea")
    const conversationId = await conversation()
    await follow(ada.id, conversationId)
    for (let i = 0; i < 10; i++) await contribution(conversationId, bea.id, `Reply ${i}`, { createdAt: `2026-11-03T1${i}:00:00Z` })

    const { items } = await getBriefing(ada.id)

    expect(items.map((i) => i.text)).toEqual([9, 8, 7, 6, 5, 4, 3, 2].map((i) => `Reply ${i}`))
  })

  it("leaves out people whose citizens are no longer active", async () => {
    const ada = await spawn("Ada")
    const bea = await spawn("Bea")
    const conversationId = await conversation()
    await follow(ada.id, conversationId)
    await contribution(conversationId, bea.id, "From someone suspended.")
    await query(`UPDATE agents SET status = 'suspended' WHERE id = $1`, [bea.id])

    await expect(getBriefing(ada.id)).resolves.toMatchObject({ items: [] })
  })

  it("includes what this agent kept, linked to where it came from", async () => {
    const ada = await spawn("Ada")
    const conversationId = await conversation()
    await query(`INSERT INTO memories (id, agent_id, conversation_id, text, created_at) VALUES ($1, $2, $3, 'Worth remembering.', now())`, [
      crypto.randomUUID(),
      ada.id,
      conversationId,
    ])

    expect((await getBriefing(ada.id)).takeaways).toEqual([expect.objectContaining({ text: "Worth remembering.", conversation_id: conversationId })])
  })

  it("keeps only this agent's own, recent takeaways, and only a few", async () => {
    const ada = await spawn("Ada")
    const bea = await spawn("Bea")
    const conversationId = await conversation()
    const keep = (agentId: string, text: string, createdAt: string) =>
      query(`INSERT INTO memories (id, agent_id, conversation_id, text, created_at) VALUES ($1, $2, $3, $4, $5)`, [
        crypto.randomUUID(),
        agentId,
        conversationId,
        text,
        createdAt,
      ])
    await keep(bea.id, "Someone else's.", "2026-11-04T09:00:00Z")
    await keep(ada.id, "Too old.", "2026-10-20T09:00:00Z")
    expect((await getBriefing(ada.id)).takeaways).toEqual([])

    for (let i = 0; i < 5; i++) await keep(ada.id, `Kept ${i}`, `2026-11-03T1${i}:00:00Z`)

    const { takeaways } = await getBriefing(ada.id)

    expect(takeaways.map((t) => t.text)).toEqual(["Kept 4", "Kept 3", "Kept 2"])
  })

  it("lists who is waiting for an answer", async () => {
    const ada = await spawn("Ada")
    const bea = await spawn("Bea")
    await askToMeet(bea.id, ada.id, "bea@example.com")

    const { waitingForYou } = await getBriefing(ada.id)

    expect(waitingForYou).toEqual([expect.objectContaining({ agentId: bea.id, name: "Bea" })])
    expect(JSON.stringify(waitingForYou)).not.toContain("bea@example.com")
  })
})

describe("today's question", () => {
  it("is empty when there are none", async () => {
    await expect(getTodaysQuestion()).resolves.toBeNull()
  })

  it("falls back to the newest open question", async () => {
    const ada = await spawn("Ada")
    await conversation({ question: "Older?", openedBy: ada.id, createdAt: "2026-11-01T00:00:00Z" })
    const newest = await conversation({ question: "Newer?", openedBy: ada.id, createdAt: "2026-11-02T00:00:00Z" })
    await conversation({ question: "Closed?", openedBy: ada.id, status: "closed", createdAt: "2026-11-03T00:00:00Z" })

    await expect(getTodaysQuestion()).resolves.toMatchObject({ id: newest, question: "Newer?", place: "studio" })
  })

  it("prefers one the city posted, even over a newer one from an agent", async () => {
    const ada = await spawn("Ada")
    const posted = await conversation({ question: "From the city?", createdAt: "2026-11-01T00:00:00Z" })
    await conversation({ question: "From an agent?", openedBy: ada.id, createdAt: "2026-11-02T00:00:00Z" })

    await expect(getTodaysQuestion()).resolves.toMatchObject({ id: posted })
  })

  it("ignores conversations that started from an idea", async () => {
    await conversation({ question: null, ideaId: crypto.randomUUID() })

    await expect(getTodaysQuestion()).resolves.toBeNull()
  })
})

describe("POST /api/admin/questions", () => {
  const SECRET = "admin-secret-for-tests"
  const request = (body: unknown, secret: string | null = SECRET) =>
    new NextRequest("http://polis.test/api/admin/questions", {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
      body: JSON.stringify(body),
    })

  beforeEach(() => vi.stubEnv("ADMIN_SECRET", SECRET))

  it("posts the question as today's", async () => {
    const res = await postQuestion(request({ place: "studio", text: " What should we make together? " }))

    expect(res.status).toBe(200)
    const { id } = await res.json()
    await expect(getTodaysQuestion()).resolves.toEqual({ id, place: "studio", question: "What should we make together?" })
  })

  it("refuses without the admin secret", async () => {
    expect((await postQuestion(request({ place: "studio", text: "A good question?" }, null))).status).toBe(401)
    expect((await postQuestion(request({ place: "studio", text: "A good question?" }, "wrong"))).status).toBe(401)
    await expect(getTodaysQuestion()).resolves.toBeNull()
  })

  it.each([
    [{ place: "dungeon", text: "A good question?" }],
    [{ place: "studio", text: "short" }],
    [{ place: "studio", text: "x".repeat(301) }],
    [{ place: "studio" }],
    [null],
  ])("refuses %j", async (body) => {
    expect((await postQuestion(request(body))).status).toBe(400)
    await expect(getTodaysQuestion()).resolves.toBeNull()
  })
})

describe("lists on the screens", () => {
  it("summarizes open conversations with who is in them", async () => {
    const ada = await spawn("Ada")
    const bea = await spawn("Bea")
    const conversationId = await conversation({ question: "A question?" })
    await contribution(conversationId, ada.id, "One.")
    await contribution(conversationId, bea.id, "Two.")
    await contribution(conversationId, bea.id, "Three.")
    await conversation({ question: "Closed?", status: "closed" })

    const list = await listOpenConversations()

    expect(list).toEqual([
      expect.objectContaining({ id: conversationId, place: "studio", topic: "A question?", isIdea: false, replies: 3 }),
    ])
    expect(list[0].people.map((p) => p.name).sort()).toEqual(["Ada", "Bea"])
  })

  it("shows an idea's own words as its topic", async () => {
    const ada = await spawn("Ada")
    const ideaId = crypto.randomUUID()
    await query(`INSERT INTO ideas (id, agent_id, place, text, created_at) VALUES ($1, $2, 'studio', 'Lend tools, not just books.', now())`, [ideaId, ada.id])
    await conversation({ question: null, ideaId })

    const [item] = await listOpenConversations()

    expect(item).toMatchObject({ topic: "Lend tools, not just books.", isIdea: true, ideaOwner: { id: ada.id, name: "Ada" } })
  })

  it("lists what someone follows, open or closed, and nobody else's", async () => {
    const ada = await spawn("Ada")
    const bea = await spawn("Bea")
    const open = await conversation({ question: "Open?" })
    const closed = await conversation({ question: "Closed?", status: "closed" })
    await follow(bea.id, await conversation({ question: "Not followed?" }))
    await follow(ada.id, open)
    await follow(ada.id, closed)

    const list = await getFollowedConversations(ada.id)

    expect(list.map((c) => c.topic).sort()).toEqual(["Closed?", "Open?"])
  })

  it("lists followed places", async () => {
    const ada = await spawn("Ada")
    const bea = await spawn("Bea")
    await query(`INSERT INTO place_follows (agent_id, place, created_at) VALUES ($1, 'studio', now())`, [ada.id])
    await query(`INSERT INTO place_follows (agent_id, place, created_at) VALUES ($1, 'commons', now())`, [bea.id])

    await expect(getFollowedPlaces(ada.id)).resolves.toEqual(["studio"])
  })

  it("lists someone's own ideas with where each one went", async () => {
    const ada = await spawn("Ada")
    const ideaId = crypto.randomUUID()
    await query(`INSERT INTO ideas (id, agent_id, place, text, created_at) VALUES ($1, $2, 'studio', 'One idea.', now())`, [ideaId, ada.id])
    await query(`INSERT INTO ideas (id, agent_id, place, text, created_at) VALUES ($1, $2, 'commons', 'Still waiting.', now())`, [crypto.randomUUID(), ada.id])
    await query(`INSERT INTO ideas (id, agent_id, place, text, created_at) VALUES ($1, $2, 'commons', 'Not mine.', now())`, [crypto.randomUUID(), (await spawn("Bea")).id])
    const conversationId = await conversation({ question: null, ideaId })

    const ideas = await getOwnIdeas(ada.id)

    expect(ideas).toHaveLength(2)
    expect(ideas.find((i) => i.text === "One idea.")?.conversation_id).toBe(conversationId)
    expect(ideas.find((i) => i.text === "Still waiting.")?.conversation_id).toBeNull()
  })

  it("lists agents met, saying whether a person is behind each one", async () => {
    const ada = await spawn("Ada")
    const bea = await spawn("Bea")
    const house = crypto.randomUUID()
    await query(`INSERT INTO agents (id, name, status, is_house, created_at) VALUES ($1, 'Mira', 'alive', TRUE, now())`, [house])
    for (const other of [bea.id, house]) {
      await query(`INSERT INTO relationships (agent_id, other_id, sentiment, updated_at) VALUES ($1, $2, 5, now())`, [ada.id, other])
    }

    const met = await getAgentsMet(ada.id)

    expect(met).toHaveLength(2)
    expect(met.find((m) => m.name === "Bea")?.is_house).toBeFalsy()
    expect(met.find((m) => m.name === "Mira")?.is_house).toBe(true)
    await expect(getAgentsMet(bea.id)).resolves.toEqual([])

    await query(`UPDATE agents SET status = 'suspended' WHERE id = $1`, [bea.id])
    expect((await getAgentsMet(ada.id)).map((m) => m.name)).toEqual(["Mira"])
  })

  it("still lets people add words while a conversation is listed", async () => {
    const ada = await spawn("Ada")
    const conversationId = await conversation({ question: "A question?" })

    await addOwnerWords(ada.id, conversationId, "My own words.")

    expect((await listOpenConversations())[0].replies).toBe(1)
  })
})
