import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  addOwnerWords,
  getConversation,
  MAX_OWNER_WORDS_PER_CONVERSATION,
  OwnerWordsError,
  shareIdea,
} from "@/lib/conversations"
import { spawnAgent } from "@/lib/queries"
import { failNext, query } from "./helpers/fake-db"

function newAgent(name = "Ada") {
  return spawnAgent({
    handle: name.toLowerCase(),
    name,
    traits: ["curious", "bold", "loyal"],
    backstory: "A long enough backstory.",
    goal: "Find a good question.",
    location: "studio",
  })
}

async function openConversation(openedBy: string, { place = "studio", status = "open" } = {}) {
  const id = crypto.randomUUID()
  await query(
    `INSERT INTO conversations (id, place, question, opened_by, status, agent_turns, created_at, updated_at)
     VALUES ($1, $2, 'What should we ask?', $3, $4, 0, now(), now())`,
    [id, place, openedBy, status],
  )
  return id
}

function at(iso: string) {
  vi.setSystemTime(new Date(iso))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  at("2026-11-03T10:00:00Z")
})

describe("sharing an idea", () => {
  it("keeps the person's words exactly as written", async () => {
    const { id: agentId } = await newAgent()
    const words = 'Small *teams* say "no" more than big ones — 100% of the time?\n\nÉtude: ünïcode & <b>tags</b> stay.'

    const { id } = await shareIdea(agentId, `  ${words}\n`, "studio")

    const { rows } = await query(`SELECT text, agent_id, place FROM ideas WHERE id = $1`, [id])
    expect(rows[0]).toMatchObject({ text: words, agent_id: agentId, place: "studio" })
  })

  it("shows up in the world feed as the owner's idea", async () => {
    const { id: agentId } = await newAgent()

    const { id } = await shareIdea(agentId, "Libraries should lend tools, not just books.", "commons")

    const { rows } = await query(`SELECT kind, location, ref_id, payload FROM world_events WHERE ref_id = $1`, [id])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: "idea",
      location: "commons",
      payload: { text: "Libraries should lend tools, not just books.", idea_id: id },
    })
  })

  it.each([
    ["too short", "short", "too_short"],
    ["blank", "      ", "too_short"],
    ["too long", "x".repeat(1001), "too_long"],
  ])("refuses text that is %s", async (_label, text, reason) => {
    const { id: agentId } = await newAgent()

    await expect(shareIdea(agentId, text, "studio")).rejects.toMatchObject({ reason })

    const { rows } = await query(`SELECT count(*)::int AS n FROM ideas`)
    expect(rows[0].n).toBe(0)
  })

  it("limits a citizen to three ideas a day, so nobody can bury everyone else's", async () => {
    const { id: agentId } = await newAgent()
    for (const [i, minute] of ["10", "11", "12"].entries()) {
      at(`2026-11-03T10:${minute}:00Z`)
      await shareIdea(agentId, `A reasonable idea, number ${i}.`, "studio")
    }

    at("2026-11-04T10:09:00Z")
    await expect(shareIdea(agentId, "A fourth idea too soon.", "studio")).rejects.toMatchObject({ reason: "idea_limit" })

    at("2026-11-04T10:11:00Z")
    await expect(shareIdea(agentId, "A new day, a new idea.", "studio")).resolves.toMatchObject({ id: expect.any(String) })
  })

  it("doesn't count one citizen's ideas against another's", async () => {
    const { id: ada } = await newAgent("Ada")
    const { id: bea } = await newAgent("Bea")
    for (const minute of ["10", "11", "12"]) {
      at(`2026-11-03T10:${minute}:00Z`)
      await shareIdea(ada, "A reasonable idea from Ada.", "studio")
    }

    await expect(shareIdea(bea, "A reasonable idea from Bea.", "studio")).resolves.toMatchObject({ id: expect.any(String) })
  })

  it("refuses a place that doesn't exist", async () => {
    const { id: agentId } = await newAgent()

    await expect(shareIdea(agentId, "A perfectly reasonable idea.", "dungeon")).rejects.toBeInstanceOf(OwnerWordsError)
  })
})

describe("adding your own words", () => {
  it("records them word for word and marks them as the owner's", async () => {
    const { id: agentId } = await newAgent()
    const conversationId = await openConversation(agentId)
    const words = "I tried this at work — it *failed* twice."

    await addOwnerWords(agentId, conversationId, words)

    const { rows } = await query(`SELECT text, author_kind, agent_id, move FROM contributions WHERE conversation_id = $1`, [
      conversationId,
    ])
    expect(rows).toEqual([{ text: words, author_kind: "owner", agent_id: agentId, move: null }])
  })

  it("doesn't use up a turn in the conversation's length limit", async () => {
    const { id: agentId } = await newAgent()
    const conversationId = await openConversation(agentId)

    await addOwnerWords(agentId, conversationId, "Worth saying out loud.")

    const { rows } = await query(`SELECT agent_turns FROM conversations WHERE id = $1`, [conversationId])
    expect(rows[0].agent_turns).toBe(0)
  })

  it("makes the person's agent follow the conversation", async () => {
    const { id: agentId } = await newAgent()
    const conversationId = await openConversation(crypto.randomUUID())

    await addOwnerWords(agentId, conversationId, "Worth saying out loud.")

    const { rows } = await query(`SELECT 1 FROM follows WHERE agent_id = $1 AND conversation_id = $2`, [
      agentId,
      conversationId,
    ])
    expect(rows).toHaveLength(1)
  })

  it("refuses a closed conversation", async () => {
    const { id: agentId } = await newAgent()
    const conversationId = await openConversation(agentId, { status: "closed" })

    await expect(addOwnerWords(agentId, conversationId, "Too late for this.")).rejects.toMatchObject({ reason: "closed" })
  })

  it("refuses a conversation that doesn't exist, including a malformed id", async () => {
    const { id: agentId } = await newAgent()

    await expect(addOwnerWords(agentId, crypto.randomUUID(), "Into the void.")).rejects.toMatchObject({ reason: "closed" })
    await expect(addOwnerWords(agentId, "not-a-uuid", "Into the void.")).rejects.toMatchObject({ reason: "closed" })
  })

  it.each([
    ["blank", "    ", "too_short"],
    ["too long", "x".repeat(1001), "too_long"],
  ])("refuses text that is %s", async (_label, text, reason) => {
    const { id: agentId } = await newAgent()
    const conversationId = await openConversation(agentId)

    await expect(addOwnerWords(agentId, conversationId, text)).rejects.toMatchObject({ reason })
  })

  it("makes a person wait between posts, sharing the wait with ideas", async () => {
    const { id: agentId } = await newAgent()
    const conversationId = await openConversation(agentId)

    await addOwnerWords(agentId, conversationId, "First thought.")
    at("2026-11-03T10:00:29Z")
    await expect(addOwnerWords(agentId, conversationId, "Second thought.")).rejects.toMatchObject({ reason: "slow_down" })
    await expect(shareIdea(agentId, "An idea right after.", "studio")).rejects.toMatchObject({ reason: "slow_down" })

    at("2026-11-03T10:00:31Z")
    await expect(addOwnerWords(agentId, conversationId, "Second thought.")).resolves.toMatchObject({ id: expect.any(String) })
  })

  it("limits one person's posts in a conversation, so nobody can take it over", async () => {
    const { id: agentId } = await newAgent()
    const conversationId = await openConversation(agentId)
    let minute = 10
    for (let i = 0; i < MAX_OWNER_WORDS_PER_CONVERSATION; i++) {
      at(`2026-11-03T10:${minute++}:00Z`)
      await addOwnerWords(agentId, conversationId, `Thought number ${i}.`)
    }

    at(`2026-11-03T10:${minute}:00Z`)
    await expect(addOwnerWords(agentId, conversationId, "One too many.")).rejects.toMatchObject({ reason: "limit" })
  })

  it("doesn't use up the wait when the post is refused", async () => {
    const { id: agentId } = await newAgent()
    const closed = await openConversation(agentId, { status: "closed" })
    const open = await openConversation(agentId)

    await expect(addOwnerWords(agentId, closed, "Too late for this.")).rejects.toMatchObject({ reason: "closed" })

    await expect(addOwnerWords(agentId, open, "This should still go through.")).resolves.toMatchObject({ id: expect.any(String) })
  })

  it("retries after a concurrency conflict", async () => {
    const { id: agentId } = await newAgent()
    const conversationId = await openConversation(agentId)
    failNext(/INSERT INTO contributions/, "40001", 1)

    await addOwnerWords(agentId, conversationId, "Worth retrying.")

    const { rows } = await query(`SELECT count(*)::int AS n FROM contributions`)
    expect(rows[0].n).toBe(1)
  })
})

describe("reading a conversation", () => {
  it("returns null for an unknown or malformed id", async () => {
    await expect(getConversation(crypto.randomUUID())).resolves.toBeNull()
    await expect(getConversation("not-a-uuid")).resolves.toBeNull()
  })

  it("lists contributions oldest first, each labeled by who wrote it", async () => {
    const { id: agentId } = await newAgent()
    const conversationId = await openConversation(agentId)
    await query(
      `INSERT INTO contributions (id, conversation_id, agent_id, author_kind, move, text, created_at)
       VALUES ($1, $2, $3, 'agent', 'challenge', 'Who pays for this?', '2026-11-03T09:00:00Z')`,
      [crypto.randomUUID(), conversationId, agentId],
    )
    await addOwnerWords(agentId, conversationId, "My own answer.")

    const view = await getConversation(conversationId)

    expect(view?.question).toBe("What should we ask?")
    expect(view?.contributions.map((c) => [c.author_kind, c.text, c.agent_name])).toEqual([
      ["agent", "Who pays for this?", "Ada"],
      ["owner", "My own answer.", "Ada"],
    ])
  })

  it("shows the exact words of the idea a conversation came from", async () => {
    const { id: agentId } = await newAgent()
    const words = "Libraries should lend tools, not just books."
    const idea = await shareIdea(agentId, words, "studio")
    const conversationId = crypto.randomUUID()
    await query(
      `INSERT INTO conversations (id, idea_id, place, opened_by, status, agent_turns, created_at, updated_at)
       VALUES ($1, $2, 'studio', $3, 'open', 0, now(), now())`,
      [conversationId, idea.id, agentId],
    )

    const view = await getConversation(conversationId)

    expect(view?.idea).toMatchObject({ id: idea.id, text: words, agent_id: agentId, agent_name: "Ada" })
    expect(view?.question).toBeNull()
  })
})
