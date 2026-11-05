import { beforeEach, describe, expect, it, vi } from "vitest"
import { getBriefing } from "@/lib/briefing"
import {
  addOwnerWords,
  getConversation,
  getFollowedConversations,
  getOwnIdeas,
  guideAgent,
  listOpenConversations,
  shareIdea,
} from "@/lib/conversations"
import { askToMeet, getIntroductions, respondToIntroduction } from "@/lib/introductions"
import { peekLoginLink, sendLoginLink } from "@/lib/login"
import { createInvites, joinWithInvite, memberFromCookies } from "@/lib/members"
import { getAgentById, getAgentEvents, getFeed, ownsAgent } from "@/lib/queries"
import {
  deleteAccount,
  removeContribution,
  removeIdea,
  setAgentPaused,
  setSuspended,
  withdrawIdea,
  withdrawWords,
} from "@/lib/removal"
import { runScheduledSlot } from "@/lib/scheduler"
import { welcomeReply } from "@/lib/simulation"
import { spawnAgent } from "./helpers/citizens"
import { failNext, query } from "./helpers/fake-db"
import { model, modelCallCount, onModelCall, textResult } from "./helpers/fake-model"

const IDEA = "Libraries should lend zebra-striped-tools to everyone."
const WORDS = "My own quokka-coloured thought about this."

async function member(name: string, idea = "An ordinary idea worth testing.", place = "commons") {
  const email = `${name.toLowerCase()}@example.com`
  const { created } = await createInvites([email])
  const joined = await joinWithInvite({
    code: created[0].code,
    name,
    traits: ["curious", "bold", "loyal"],
    interests: `${name}'s interests`,
    idea,
    place: place as "commons",
  })
  return { ...joined, email, code: created[0].code }
}

const house = (name: string, location = "commons") =>
  spawnAgent({ handle: name.toLowerCase(), name, traits: ["calm"], backstory: "", goal: "A goal.", location }).then(async (agent) => {
    await query(`UPDATE agents SET is_house = TRUE WHERE id = $1`, [agent.id])
    return agent
  })

// What an agent saying something leaves behind, written directly so each test controls it.
async function agentSays(agentId: string, conversationId: string, text: string, memoryId: string | null = null) {
  const id = crypto.randomUUID()
  await query(
    `INSERT INTO contributions (id, conversation_id, agent_id, author_kind, move, text, memory_id, guided, created_at)
     VALUES ($1, $2, $3, 'agent', 'challenge', $4, $5, FALSE, now())`,
    [id, conversationId, agentId, text, memoryId],
  )
  await query(
    `INSERT INTO world_events (id, agent_id, kind, payload, location, ref_id, created_at)
     VALUES ($1, $2, 'challenge', $3::jsonb, 'commons', $4, now())`,
    [crypto.randomUUID(), agentId, JSON.stringify({ text, conversation_id: conversationId }), id],
  )
  return id
}

async function takeaway(agentId: string, conversationId: string, text: string) {
  const id = crypto.randomUUID()
  await query(`INSERT INTO memories (id, agent_id, conversation_id, text, created_at) VALUES ($1, $2, $3, $4, now())`, [
    id,
    agentId,
    conversationId,
    text,
  ])
  return id
}

async function question() {
  const id = crypto.randomUUID()
  await query(
    `INSERT INTO conversations (id, place, question, status, agent_turns, created_at, updated_at)
     VALUES ($1, 'commons', 'What should we ask?', 'open', 0, now(), now())`,
    [id],
  )
  return id
}

// Every row of every table, so nothing can hide in a copy nobody thought of.
async function everything(): Promise<string> {
  const { rows } = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)
  const dumps = await Promise.all(rows.map((r) => query(`SELECT * FROM ${r.table_name}`)))
  return JSON.stringify(dumps.map((d) => d.rows))
}

const prompts = () => JSON.stringify(model.doGenerateCalls.map((call) => call.prompt))
const MOVE = JSON.stringify({ type: "move", text: "a thought", to: "studio", idea_ref: null, conversation_ref: null, kind: null, takeaway: null, memory_ref: null })
const ideaIdOf = async (conversationId: string) =>
  (await query(`SELECT idea_id::text AS id FROM conversations WHERE id = $1`, [conversationId])).rows[0].id as string

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-04T10:01:00Z"))
  vi.stubEnv("EMAIL_FROM", "hello@city.test")
  vi.stubEnv("AWS_EMAIL_ROLE_ARN", "arn:aws:iam::123456789012:role/email")
  vi.stubEnv("APP_URL", "https://city.test")
  vi.stubEnv("EMAIL_REPLY_TO", "founder@example.com")
  onModelCall(async () => textResult(MOVE))
})

describe("withdrawing an idea", () => {
  it("leaves its text nowhere at all, including agents that repeated it", async () => {
    const ada = await member("Ada", IDEA)
    const mira = await house("Mira")
    const ideaId = await ideaIdOf(ada.conversationId)
    await agentSays(mira.id, ada.conversationId, `So ${IDEA} is your claim?`)
    await takeaway(mira.id, ada.conversationId, `${IDEA} stuck with me.`)
    expect(await everything()).toContain("zebra-striped-tools")

    await expect(withdrawIdea(ada.id, ideaId)).resolves.toBe(true)

    expect(await everything()).not.toContain("zebra-striped-tools")
  })

  it("can only be done by the person who shared it", async () => {
    const ada = await member("Ada", IDEA)
    const bea = await member("Bea")

    await expect(withdrawIdea(bea.id, await ideaIdOf(ada.conversationId))).resolves.toBe(false)

    expect(await everything()).toContain("zebra-striped-tools")
    expect((await getConversation(ada.conversationId))?.status).toBe("open")
  })

  it("closes the conversation, and marks what was removed", async () => {
    const ada = await member("Ada", IDEA)
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "A reply about it.")

    await withdrawIdea(ada.id, await ideaIdOf(ada.conversationId))

    const room = await getConversation(ada.conversationId)
    expect(room).toMatchObject({ status: "closed", idea: { text: "" } })
    expect(room?.contributions[0].text).toBe("")
  })

  it("keeps other people's own words exactly as they wrote them", async () => {
    const ada = await member("Ada", IDEA)
    const bea = await member("Bea")
    await addOwnerWords(bea.id, ada.conversationId, "  I disagree, and here's why.  ")

    await withdrawIdea(ada.id, await ideaIdOf(ada.conversationId))

    const room = await getConversation(ada.conversationId)
    expect(room?.contributions[0].text).toBe("I disagree, and here's why.")
  })

  it("removes what an agent said elsewhere that drew on it, and leaves the rest of that room", async () => {
    const ada = await member("Ada", IDEA)
    const mira = await house("Mira")
    const elsewhere = await question()
    const kept = await takeaway(mira.id, ada.conversationId, "Tools matter.")
    const cited = await agentSays(mira.id, elsewhere, "Drawing on it: tools matter.", kept)
    const unrelated = await agentSays(mira.id, elsewhere, "Something else entirely.")

    await withdrawIdea(ada.id, await ideaIdOf(ada.conversationId))

    const room = await getConversation(elsewhere)
    expect(room?.contributions.find((c) => c.id === cited)?.text).toBe("")
    expect(room?.contributions.find((c) => c.id === unrelated)?.text).toBe("Something else entirely.")
  })

  it("removes agents quoting it in other rooms, and leaves replies there that don't", async () => {
    const ada = await member("Ada", IDEA)
    const mira = await house("Mira")
    const elsewhere = await question()
    await agentSays(mira.id, elsewhere, `It connects to this: ${IDEA}`)
    await takeaway(mira.id, elsewhere, `Keep in mind: ${IDEA}`)
    const other = await agentSays(mira.id, elsewhere, "An unrelated thought about libraries.")

    await withdrawIdea(ada.id, await ideaIdOf(ada.conversationId))

    expect(await everything()).not.toContain("zebra-striped-tools")
    expect((await getConversation(elsewhere))?.contributions.find((c) => c.id === other)?.text).toBe("An unrelated thought about libraries.")
  })

  it("makes agents who took part write a new journal", async () => {
    const ada = await member("Ada", IDEA)
    const mira = await house("Mira")
    const other = await house("Oda")
    await agentSays(mira.id, ada.conversationId, "A reply.")
    await query(`INSERT INTO agent_journals (agent_id, journal, updated_at) VALUES ($1, 'Mira saw zebra-striped-tools.', now())`, [mira.id])
    await query(`INSERT INTO agent_journals (agent_id, journal, updated_at) VALUES ($1, 'Oda had a quiet day.', now())`, [other.id])

    await withdrawIdea(ada.id, await ideaIdOf(ada.conversationId))

    const { rows } = await query(`SELECT agent_id::text AS id, journal FROM agent_journals`)
    expect(rows.find((r) => r.id === mira.id)?.journal).toBeNull()
    expect(rows.find((r) => r.id === other.id)?.journal).toBe("Oda had a quiet day.")
  })

  it("is out of the lists, the briefing and the feed", async () => {
    const ada = await member("Ada", IDEA)
    const bea = await member("Bea")
    const mira = await house("Mira")
    await query(`INSERT INTO follows (agent_id, conversation_id, created_at) VALUES ($1, $2, now())`, [bea.id, ada.conversationId])
    await agentSays(mira.id, ada.conversationId, "A reply.")

    await withdrawIdea(ada.id, await ideaIdOf(ada.conversationId))

    expect((await listOpenConversations()).map((c) => c.id)).not.toContain(ada.conversationId)
    expect((await getFollowedConversations(bea.id)).map((c) => c.id)).not.toContain(ada.conversationId)
    expect((await getBriefing(bea.id)).items).toEqual([])
    expect(JSON.stringify(await getFeed())).not.toContain("zebra-striped-tools")
    expect(JSON.stringify(await getAgentEvents(ada.id))).not.toContain("zebra-striped-tools")
  })

  it("stops other people's words in that room from reaching anyone's briefing", async () => {
    const ada = await member("Ada", IDEA)
    const bea = await member("Bea")
    const cal = await member("Cal")
    await query(`INSERT INTO follows (agent_id, conversation_id, created_at) VALUES ($1, $2, now())`, [cal.id, ada.conversationId])
    vi.setSystemTime(new Date("2026-11-04T10:02:00Z"))
    await addOwnerWords(bea.id, ada.conversationId, "Bea's words in that room.")

    await withdrawIdea(ada.id, await ideaIdOf(ada.conversationId))

    expect(JSON.stringify(await getBriefing(cal.id))).not.toContain("Bea's words in that room.")
  })

  it("shows its owner that it was withdrawn, without the text", async () => {
    const ada = await member("Ada", IDEA)

    await withdrawIdea(ada.id, await ideaIdOf(ada.conversationId))

    const [idea] = await getOwnIdeas(ada.id)
    expect(idea.text).toBe("")
    expect(idea.withdrawn_at).toBeTruthy()
  })

  it("never reaches a prompt again, on a turn or a welcome", async () => {
    const ada = await member("Ada")
    const { id: ideaId } = await shareIdea(ada.id, IDEA, "commons").catch(async () => {
      vi.setSystemTime(new Date("2026-11-04T10:02:00Z"))
      return shareIdea(ada.id, IDEA, "commons")
    })
    await house("Mira")

    await withdrawIdea(ada.id, ideaId)
    await runScheduledSlot()
    await welcomeReply(ada.conversationId)

    expect(modelCallCount()).toBeGreaterThan(0)
    expect(prompts()).not.toContain("zebra-striped-tools")
    expect(prompts()).not.toMatch(/I\d: from Ada's owner, in their own words:\\n<untrusted>\\n\\n/)
  })

  it("can't be done twice", async () => {
    const ada = await member("Ada", IDEA)
    const ideaId = await ideaIdOf(ada.conversationId)

    await expect(withdrawIdea(ada.id, ideaId)).resolves.toBe(true)
    await expect(withdrawIdea(ada.id, ideaId)).resolves.toBe(false)
  })

  it("refuses an id that isn't one", async () => {
    const ada = await member("Ada", IDEA)

    await expect(withdrawIdea(ada.id, "not-an-id")).resolves.toBe(false)
  })

  it("changes nothing if the write fails, and retries a conflict", async () => {
    const ada = await member("Ada", IDEA)
    const ideaId = await ideaIdOf(ada.conversationId)

    failNext(/UPDATE conversations SET status/, "XX000")
    await expect(withdrawIdea(ada.id, ideaId)).rejects.toMatchObject({ code: "XX000" })
    expect(await everything()).toContain("zebra-striped-tools")

    failNext(/UPDATE conversations SET status/)
    await expect(withdrawIdea(ada.id, ideaId)).resolves.toBe(true)
    expect(await everything()).not.toContain("zebra-striped-tools")
  })
})

describe("withdrawing your own words", () => {
  async function room() {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const { id } = await addOwnerWords(bea.id, ada.conversationId, WORDS)
    return { ada, bea, wordsId: id }
  }

  it("removes them from everywhere", async () => {
    const { bea, wordsId } = await room()
    expect(await everything()).toContain("quokka-coloured")

    await expect(withdrawWords(bea.id, wordsId)).resolves.toBe(true)

    expect(await everything()).not.toContain("quokka-coloured")
  })

  it("can only be done by whoever wrote them", async () => {
    const { ada, wordsId } = await room()

    await expect(withdrawWords(ada.id, wordsId)).resolves.toBe(false)

    expect(await everything()).toContain("quokka-coloured")
  })

  it("can't be used on what an agent said", async () => {
    const { ada, bea } = await room()
    const said = await agentSays(bea.id, ada.conversationId, "Bea's agent said this.")

    await expect(withdrawWords(bea.id, said)).resolves.toBe(false)
  })

  it("removes agent text that quotes them whole, whatever the capitals and spacing", async () => {
    const { ada, bea, wordsId } = await room()
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, `She wrote "MY OWN  quokka-coloured thought about this." Odd.`)
    await takeaway(mira.id, ada.conversationId, `Remember: ${WORDS}`)

    await withdrawWords(bea.id, wordsId)

    expect(await everything()).not.toContain("quokka-coloured")
    expect((await getBriefing(mira.id)).takeaways).toEqual([])
  })

  it("leaves agent replies that don't quote them", async () => {
    const { ada, bea, wordsId } = await room()
    const mira = await house("Mira")
    const reply = await agentSays(mira.id, ada.conversationId, "A reply in its own words.")

    await withdrawWords(bea.id, wordsId)

    const after = await getConversation(ada.conversationId)
    expect(after?.contributions.find((c) => c.id === reply)?.text).toBe("A reply in its own words.")
    expect(after?.status).toBe("open")
  })

  it("removes agent text that quotes a sentence of them, whatever the punctuation", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const mira = await house("Mira")
    const long = "We keep shipping too late. What if every small team shipped before Friday, no matter how rough it looked? Then we would learn."
    const { id } = await addOwnerWords(bea.id, ada.conversationId, long)
    const quoting = await agentSays(mira.id, ada.conversationId, `You said: every small team shipped "before Friday, no matter how rough" - why?`)
    const brief = await agentSays(mira.id, ada.conversationId, "Shipped before Friday? Then what?")

    await withdrawWords(bea.id, id)

    const after = await getConversation(ada.conversationId)
    expect(after?.contributions.find((c) => c.id === quoting)?.text).toBe("")
    expect(after?.contributions.find((c) => c.id === brief)?.text).toBe("Shipped before Friday? Then what?")
  })

  it("finds quotes of them in other rooms too", async () => {
    const { bea, wordsId } = await room()
    const mira = await house("Mira")
    const elsewhere = await question()
    await agentSays(mira.id, elsewhere, `Someone wrote: ${WORDS}`)
    await takeaway(mira.id, elsewhere, `Remember: ${WORDS}`)

    await withdrawWords(bea.id, wordsId)

    expect(await everything()).not.toContain("quokka-coloured")
  })

  it("doesn't treat a very short message as a quote", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const mira = await house("Mira")
    const { id } = await addOwnerWords(bea.id, ada.conversationId, "Yes.")
    const reply = await agentSays(mira.id, ada.conversationId, "Yes. That seems right to me.")

    await withdrawWords(bea.id, id)

    const after = await getConversation(ada.conversationId)
    expect(after?.contributions.find((c) => c.id === reply)?.text).toBe("Yes. That seems right to me.")
  })

  it("stops reaching prompts", async () => {
    const { ada, bea, wordsId } = await room()
    await house("Mira")

    await withdrawWords(bea.id, wordsId)
    await query(`UPDATE conversations SET agent_turns = 0 WHERE id = $1`, [ada.conversationId])
    await welcomeReply(ada.conversationId)

    expect(modelCallCount()).toBe(1)
    expect(prompts()).not.toContain("quokka-coloured")
    expect(prompts()).not.toContain("Bea's owner, in their own words")
  })

  it("isn't counted as a reply on the lists", async () => {
    const { ada, bea, wordsId } = await room()

    await withdrawWords(bea.id, wordsId)

    expect((await listOpenConversations()).find((c) => c.id === ada.conversationId)?.replies).toBe(0)
  })

  it("still counts toward the limit, so it can't be used to post without end", async () => {
    const { ada, bea, wordsId } = await room()

    await withdrawWords(bea.id, wordsId)

    const { rows } = await query(`SELECT count(*)::int AS n FROM contributions WHERE conversation_id = $1 AND agent_id = $2`, [
      ada.conversationId,
      bea.id,
    ])
    expect(rows[0].n).toBe(1)
  })
})

describe("deleting an account", () => {
  it("leaves nothing of the person anywhere", async () => {
    const ada = await member("Adalind", IDEA)
    const bea = await member("Bea")
    const mira = await house("Mira")
    await agentSays(ada.id, bea.conversationId, "Adalind's agent saying unicorn-shaped things.")
    await addOwnerWords(ada.id, bea.conversationId, WORDS)
    await takeaway(ada.id, bea.conversationId, "A narwhal-sized takeaway.")
    await agentSays(mira.id, ada.conversationId, `Replying to ${IDEA}`)
    await query(`INSERT INTO agent_journals (agent_id, journal, updated_at) VALUES ($1, 'A pangolin-themed day.', now())`, [ada.id])
    vi.setSystemTime(new Date("2026-11-04T10:05:00Z"))
    await askToMeet(ada.id, bea.id, "ada-signal-handle")
    await respondToIntroduction(bea.id, ada.id, true, "bea-signal-handle")
    await sendLoginLink(ada.email)

    await expect(deleteAccount(ada.id)).resolves.toBe(true)

    const left = await everything()
    for (const trace of ["zebra-striped-tools", "quokka-coloured", "unicorn-shaped", "narwhal-sized", "pangolin-themed", "ada-signal-handle", "bea-signal-handle", ada.email, ada.ownerToken, "Adalind", "adalind"]) {
      expect(left, trace).not.toContain(trace)
    }
  })

  it("leaves no row pointing at them, except blanked ones that hold conversations together", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const cal = await member("Cal")
    vi.setSystemTime(new Date("2026-11-04T10:05:00Z"))
    await askToMeet(ada.id, bea.id, "ada-contact")
    await askToMeet(cal.id, ada.id, "cal-contact")
    await query(`INSERT INTO relationships (agent_id, other_id, sentiment, updated_at) VALUES ($1, $2, 5, now()), ($2, $1, 5, now())`, [ada.id, bea.id])
    await query(`INSERT INTO world_events (id, agent_id, kind, payload, location, created_at) VALUES ($1, $2, 'move', '{"text":"a thought"}'::jsonb, 'commons', now())`, [crypto.randomUUID(), ada.id])
    await query(`INSERT INTO agent_journals (agent_id, journal, updated_at) VALUES ($1, 'A day.', now())`, [ada.id])
    await takeaway(ada.id, bea.conversationId, "Something kept.")
    await query(`INSERT INTO reports (id, reporter_id, agent_id, reason, created_at) VALUES ($1, $2, $3, 'other', now())`, [crypto.randomUUID(), ada.id, bea.id])
    await query(`INSERT INTO follows (agent_id, conversation_id, created_at) VALUES ($1, $2, now())`, [ada.id, bea.conversationId])

    await deleteAccount(ada.id)

    for (const [table, column] of [
      ["world_events", "agent_id"],
      ["agent_journals", "agent_id"],
      ["follows", "agent_id"],
      ["place_follows", "agent_id"],
      ["relationships", "agent_id"],
      ["relationships", "other_id"],
      ["introductions", "requester_id"],
      ["introductions", "recipient_id"],
      ["memories", "agent_id"],
      ["login_links", "agent_id"],
      ["members", "agent_id"],
      ["reports", "reporter_id"],
    ]) {
      const { rows } = await query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [ada.id])
      expect(rows[0].n, `${table}.${column}`).toBe(0)
    }
    const { rows } = await query(`SELECT count(*)::int AS n FROM contributions WHERE agent_id = $1 AND text <> ''`, [ada.id])
    expect(rows[0].n).toBe(0)
  })

  it("removes other agents quoting them in other rooms, whether it's their idea, words or agent", async () => {
    const ada = await member("Ada", IDEA)
    const bea = await member("Bea")
    const mira = await house("Mira")
    const elsewhere = await question()
    await addOwnerWords(ada.id, bea.conversationId, WORDS)
    await agentSays(ada.id, bea.conversationId, "Her agent said something about a very specific capybara parade today.")
    await agentSays(mira.id, elsewhere, `Quoting the idea: ${IDEA}`)
    await agentSays(mira.id, elsewhere, `Quoting the words: ${WORDS}`)
    await agentSays(mira.id, elsewhere, `Quoting the agent: something about a very specific capybara parade today.`)
    const unrelated = await agentSays(mira.id, elsewhere, "An unrelated thought.")

    await deleteAccount(ada.id)

    const left = await everything()
    for (const trace of ["zebra-striped-tools", "quokka-coloured", "capybara"]) expect(left, trace).not.toContain(trace)
    expect((await getConversation(elsewhere))?.contributions.find((c) => c.id === unrelated)?.text).toBe("An unrelated thought.")
  })

  it("closes the door: the old cookie and old links stop working", async () => {
    const ada = await member("Ada", IDEA)
    await sendLoginLink(ada.email)

    await deleteAccount(ada.id)

    await expect(ownsAgent(ada.id, ada.ownerToken)).resolves.toBe(false)
    await expect(memberFromCookies([{ name: `polis-own-${ada.id}`, value: ada.ownerToken }])).resolves.toBeNull()
    const { rows } = await query(`SELECT count(*)::int AS n FROM login_links`)
    expect(rows[0].n).toBe(0)
  })

  it("stops the agent, frees the name, and lets the person be invited again", async () => {
    const ada = await member("Ada", IDEA)
    await deleteAccount(ada.id)

    expect(await getAgentById(ada.id)).toMatchObject({ name: "Former citizen", status: "deleted", interests: null, goal: "" })
    await runScheduledSlot()
    expect(prompts()).not.toContain("Former citizen")

    await expect(member("Ada")).resolves.toBeTruthy()
  })

  it("makes an unused invite to that address unusable", async () => {
    const ada = await member("Ada")
    const { created } = await createInvites(["ada2@example.com"])
    await query(`INSERT INTO members (email, agent_id, created_at) VALUES ('ada2@example.com', $1, now())`, [ada.id])

    await deleteAccount(ada.id)

    await expect(
      joinWithInvite({ code: created[0].code, name: "Someone", traits: ["curious", "bold", "loyal"], interests: "things", idea: "An ordinary idea.", place: "commons" }),
    ).rejects.toMatchObject({ reason: "invite" })
  })

  it("removes their side of introductions, for both people", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    await askToMeet(ada.id, bea.id, "ada-contact")
    await respondToIntroduction(bea.id, ada.id, true, "bea-contact")

    await deleteAccount(ada.id)

    await expect(getIntroductions(bea.id)).resolves.toEqual({ incoming: [], outgoing: [], connected: [] })
  })

  it("lowers the population by one", async () => {
    const ada = await member("Ada")
    await member("Bea")

    await deleteAccount(ada.id)

    const { rows } = await query(`SELECT sum(value)::int AS n FROM world_counters WHERE counter_name = 'population'`)
    expect(rows[0].n).toBe(1)
  })

  it("refuses a house agent and someone already gone", async () => {
    const mira = await house("Mira")
    const ada = await member("Ada")

    await expect(deleteAccount(mira.id)).resolves.toBe(false)
    await expect(deleteAccount(ada.id)).resolves.toBe(true)
    await expect(deleteAccount(ada.id)).resolves.toBe(false)
  })

  it("keeps everything if the write fails partway", async () => {
    const ada = await member("Ada", IDEA)

    failNext(/DELETE FROM members/, "XX000")
    await expect(deleteAccount(ada.id)).rejects.toMatchObject({ code: "XX000" })

    expect(await everything()).toContain("zebra-striped-tools")
    await expect(ownsAgent(ada.id, ada.ownerToken)).resolves.toBe(true)
  })

  it("copes with more than an agent could say at six turns a day over two weeks", async () => {
    const ada = await member("Ada", IDEA)
    const bea = await member("Bea")
    for (let i = 0; i < 100; i++) await agentSays(ada.id, bea.conversationId, `Turn ${i}`)

    await deleteAccount(ada.id)

    const { rows } = await query(`SELECT count(*)::int AS n FROM contributions WHERE agent_id = $1 AND text = ''`, [ada.id])
    expect(rows[0].n).toBe(100)
  })
})

describe("suspending someone", () => {
  it("hides their words, ideas and name, and shows others' as before", async () => {
    const ada = await member("Ada", IDEA)
    const bea = await member("Bea")
    await addOwnerWords(ada.id, bea.conversationId, WORDS)
    vi.setSystemTime(new Date("2026-11-04T10:03:00Z"))
    await addOwnerWords(bea.id, bea.conversationId, "Bea's own words.")

    await expect(setSuspended(ada.id, true)).resolves.toBe(true)

    const shown = JSON.stringify(await getConversation(bea.conversationId))
    expect(shown).not.toContain("quokka-coloured")
    expect(shown).not.toContain("Ada")
    expect(shown).toContain("Bea's own words.")
    expect((await listOpenConversations()).map((c) => c.id)).not.toContain(ada.conversationId)
    expect(JSON.stringify(await getConversation(ada.conversationId))).not.toContain("zebra-striped-tools")
    expect(JSON.stringify(await getFeed())).not.toContain("zebra-striped-tools")
    expect(JSON.stringify(await getFeed())).not.toContain("quokka-coloured")
  })

  it("keeps them out of follow lists and briefings", async () => {
    const ada = await member("Ada", IDEA)
    const bea = await member("Bea")
    await query(`INSERT INTO follows (agent_id, conversation_id, created_at) VALUES ($1, $2, now())`, [bea.id, ada.conversationId])
    await addOwnerWords(ada.id, bea.conversationId, WORDS)

    await setSuspended(ada.id, true)

    expect((await getFollowedConversations(bea.id)).map((c) => c.id)).not.toContain(ada.conversationId)
    expect(JSON.stringify(await getBriefing(bea.id))).not.toContain("quokka-coloured")
  })

  it("keeps their words and ideas out of prompts, and stops their agent", async () => {
    const ada = await member("Ada", IDEA)
    const bea = await member("Bea")
    await addOwnerWords(ada.id, bea.conversationId, WORDS)
    await query(`UPDATE agents SET last_attempt_at = now() WHERE id <> $1`, [bea.id])
    await query(`UPDATE agents SET last_attempt_at = NULL WHERE id = $1`, [bea.id])

    await setSuspended(ada.id, true)
    await runScheduledSlot()

    expect(modelCallCount()).toBe(1)
    expect(prompts()).toContain("You are Bea.")
    expect(prompts()).not.toContain("zebra-striped-tools")
    expect(prompts()).not.toContain("quokka-coloured")
  })

  it("takes them off the list of agents others remember talking to", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    await query(`INSERT INTO relationships (agent_id, other_id, sentiment, updated_at) VALUES ($1, $2, 5, now())`, [bea.id, ada.id])
    await query(`UPDATE agents SET last_attempt_at = now() WHERE id <> $1`, [bea.id])

    await setSuspended(ada.id, true)
    await runScheduledSlot()

    expect(prompts()).toContain("You are Bea.")
    expect(prompts()).not.toContain("- Ada")
  })

  it("shuts them out, and their sign-in links stop working", async () => {
    const ada = await member("Ada")
    await sendLoginLink(ada.email)
    const token = (await import("./helpers/fake-email")).sentEmails[0].text.match(/\/login\/([\w-]+)/)?.[1] as string

    await setSuspended(ada.id, true)

    await expect(ownsAgent(ada.id, ada.ownerToken)).resolves.toBe(false)
    await expect(peekLoginLink(token)).resolves.toBeNull()
  })

  describe("when they shared the idea a conversation is about", () => {
    async function room() {
      const ada = await member("Ada", IDEA)
      const bea = await member("Bea")
      const mira = await house("Mira")
      vi.setSystemTime(new Date("2026-11-04T10:02:00Z"))
      const reply = await agentSays(mira.id, ada.conversationId, `So ${IDEA}?`)
      await query(`INSERT INTO follows (agent_id, conversation_id, created_at) VALUES ($1, $2, now())`, [bea.id, ada.conversationId])
      await query(`UPDATE contributions SET created_at = $1 WHERE id = $2`, [new Date().toISOString(), reply])
      return { ada, bea, mira, reply }
    }

    it("hides agents' replies too, since they could repeat it", async () => {
      const { ada, reply } = await room()
      await setSuspended(ada.id, true)

      const shown = await getConversation(ada.conversationId)
      expect(shown?.contributions.find((c) => c.id === reply)?.text).toBe("")
      expect(JSON.stringify(shown)).not.toContain("zebra-striped-tools")
    })

    it("keeps those replies out of briefings, the feed and agents' pages", async () => {
      const { ada, bea, mira } = await room()
      await setSuspended(ada.id, true)

      expect(JSON.stringify(await getBriefing(bea.id))).not.toContain("zebra-striped-tools")
      expect(JSON.stringify(await getFeed())).not.toContain("zebra-striped-tools")
      expect(JSON.stringify(await getAgentEvents(mira.id))).not.toContain("zebra-striped-tools")
    })

    it("keeps what agents took from it out of their prompts and briefings", async () => {
      const { ada, mira } = await room()
      await takeaway(mira.id, ada.conversationId, `${IDEA} stuck with me.`)
      await setSuspended(ada.id, true)

      expect(JSON.stringify(await getBriefing(mira.id))).not.toContain("zebra-striped-tools")
      await runScheduledSlot()
      expect(prompts()).not.toContain("zebra-striped-tools")
    })

    it("hides a takeaway from there that's cited in another room", async () => {
      const { ada, mira } = await room()
      const kept = await takeaway(mira.id, ada.conversationId, `${IDEA} stuck with me.`)
      const elsewhere = await question()
      await agentSays(mira.id, elsewhere, "Drawing on what I remember.", kept)
      await setSuspended(ada.id, true)

      expect(JSON.stringify(await getConversation(elsewhere))).not.toContain("zebra-striped-tools")
    })

    it("doesn't send anyone there with Guide, or welcome it", async () => {
      const { ada, bea } = await room()
      await query(`UPDATE agents SET last_attempt_at = now() WHERE id <> $1`, [bea.id])
      await guideAgent(bea.id, ada.conversationId, "challenge")
      await setSuspended(ada.id, true)

      await runScheduledSlot()

      expect(modelCallCount()).toBe(1)
      expect(prompts()).toContain("You are Bea.")
      expect(prompts()).not.toContain("zebra-striped-tools")
    })

    it("doesn't ask a house agent to welcome it", async () => {
      const ada = await member("Ada", IDEA)
      await house("Mira")
      await setSuspended(ada.id, true)

      await expect(welcomeReply(ada.conversationId)).resolves.toBe(false)

      expect(modelCallCount()).toBe(0)
    })

    it("hides whose idea it was", async () => {
      const { ada } = await room()
      await setSuspended(ada.id, true)

      expect(JSON.stringify(await getConversation(ada.conversationId))).not.toContain("Ada")
    })

    it("won't take new words there", async () => {
      const { ada, bea } = await room()
      await setSuspended(ada.id, true)

      await expect(addOwnerWords(bea.id, ada.conversationId, "Words into a hidden room.")).rejects.toMatchObject({ reason: "closed" })
    })

    it("puts it all back when lifted", async () => {
      const { ada, bea, reply } = await room()
      await setSuspended(ada.id, true)
      await setSuspended(ada.id, false)

      const shown = await getConversation(ada.conversationId)
      expect(shown?.contributions.find((c) => c.id === reply)?.text).toBe(`So ${IDEA}?`)
      expect(JSON.stringify(await getBriefing(bea.id))).toContain("zebra-striped-tools")
    })
  })

  it("puts everything back as it was when lifted", async () => {
    const ada = await member("Ada", IDEA)
    await setSuspended(ada.id, true)

    await expect(setSuspended(ada.id, false)).resolves.toBe(true)

    expect((await getConversation(ada.conversationId))?.idea).toMatchObject({ text: IDEA, agent_name: "Ada" })
    await expect(ownsAgent(ada.id, ada.ownerToken)).resolves.toBe(true)
  })

  it("does nothing to someone deleted, or twice", async () => {
    const ada = await member("Ada")
    await deleteAccount(ada.id)
    await expect(setSuspended(ada.id, true)).resolves.toBe(false)
    await expect(setSuspended(ada.id, false)).resolves.toBe(false)
    await expect(setSuspended("not-an-id", true)).resolves.toBe(false)

    const bea = await member("Bea")
    await expect(setSuspended(bea.id, true)).resolves.toBe(true)
    await expect(setSuspended(bea.id, true)).resolves.toBe(false)
  })
})

describe("a turn that's already under way", () => {
  const ADD = JSON.stringify({ type: "add", text: "My reply.", to: null, idea_ref: null, conversation_ref: "C1", kind: "question", takeaway: "Worth keeping.", memory_ref: null })

  async function citizenWithATurn() {
    const ada = await member("Ada")
    await query(`UPDATE conversations SET status = 'closed' WHERE id = $1`, [ada.conversationId])
    const room = await question()
    return { ada, room }
  }

  const said = async (agentId: string) =>
    (await query(`SELECT count(*)::int AS n FROM contributions WHERE agent_id = $1`, [agentId])).rows[0].n as number

  it("lands normally when nothing has changed", async () => {
    const { ada } = await citizenWithATurn()
    onModelCall(async () => textResult(ADD))

    await runScheduledSlot()

    expect(await said(ada.id)).toBe(1)
  })

  it.each([
    ["deletes their account", (id: string) => deleteAccount(id)],
    ["is suspended", (id: string) => setSuspended(id, true)],
    ["pauses their agent", (id: string) => setAgentPaused(id, true)],
  ])("doesn't land if its owner %s while the model is thinking", async (_what, change) => {
    const { ada } = await citizenWithATurn()
    onModelCall(async () => {
      await change(ada.id)
      return textResult(ADD)
    })

    await runScheduledSlot()

    expect(await said(ada.id)).toBe(0)
    const { rows } = await query(`SELECT count(*)::int AS n FROM memories WHERE agent_id = $1`, [ada.id])
    expect(rows[0].n).toBe(0)
  })

  it("doesn't open a conversation on an idea withdrawn while the model is thinking", async () => {
    const ada = await member("Ada")
    await query(`UPDATE conversations SET status = 'closed' WHERE id = $1`, [ada.conversationId])
    vi.setSystemTime(new Date("2026-11-04T10:02:00Z"))
    const { id: ideaId } = await shareIdea(ada.id, IDEA, "commons")
    onModelCall(async () => {
      await withdrawIdea(ada.id, ideaId)
      return textResult(JSON.stringify({ type: "open", text: "Opening on it.", to: null, idea_ref: "I1", conversation_ref: null, kind: null, takeaway: null, memory_ref: null }))
    })

    await runScheduledSlot()

    const { rows } = await query(`SELECT count(*)::int AS n FROM conversations WHERE idea_id = $1`, [ideaId])
    expect(rows[0].n).toBe(0)
  })

  it("still opens a conversation on an idea nobody withdrew", async () => {
    const ada = await member("Ada")
    await query(`UPDATE conversations SET status = 'closed' WHERE id = $1`, [ada.conversationId])
    vi.setSystemTime(new Date("2026-11-04T10:02:00Z"))
    const { id: ideaId } = await shareIdea(ada.id, IDEA, "commons")
    onModelCall(async () =>
      textResult(JSON.stringify({ type: "open", text: "Opening on it.", to: null, idea_ref: "I1", conversation_ref: null, kind: null, takeaway: null, memory_ref: null })),
    )

    await runScheduledSlot()

    const { rows } = await query(`SELECT count(*)::int AS n FROM conversations WHERE idea_id = $1`, [ideaId])
    expect(rows[0].n).toBe(1)
  })
})

describe("the founder removing something", () => {
  it("takes an agent's removed words out of its own memory of what it said", async () => {
    const mira = await house("Mira")
    const room = await question()
    const id = await agentSays(mira.id, room, "Something awful.")

    await removeContribution(id)
    await query(`UPDATE conversations SET status = 'closed'`)
    await runScheduledSlot()

    expect(prompts()).toContain("You are Mira.")
    expect(prompts()).not.toContain("- challenge:")
  })

  it("removes anyone's words, including quotes of them", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const mira = await house("Mira")
    const { id } = await addOwnerWords(bea.id, ada.conversationId, WORDS)
    await agentSays(mira.id, ada.conversationId, `Quoting: ${WORDS}`)

    await expect(removeContribution(id)).resolves.toBe(true)

    expect(await everything()).not.toContain("quokka-coloured")
  })

  it("removes what an agent said", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    const id = await agentSays(mira.id, ada.conversationId, "Something awful about walruses.")

    await expect(removeContribution(id)).resolves.toBe(true)
    await expect(removeContribution(id)).resolves.toBe(false)

    expect(await everything()).not.toContain("walruses")
  })

  it("removes anyone's idea, including quotes of it elsewhere", async () => {
    const ada = await member("Ada", IDEA)
    const mira = await house("Mira")
    await agentSays(mira.id, await question(), `It connects to this: ${IDEA}`)

    await expect(removeIdea(await ideaIdOf(ada.conversationId))).resolves.toBe(true)

    expect(await everything()).not.toContain("zebra-striped-tools")
  })

  it("refuses ids that aren't one or don't exist", async () => {
    await expect(removeContribution("nope")).resolves.toBe(false)
    await expect(removeIdea("nope")).resolves.toBe(false)
    await expect(removeContribution(crypto.randomUUID())).resolves.toBe(false)
    await expect(removeIdea(crypto.randomUUID())).resolves.toBe(false)
  })
})

describe("pausing an agent", () => {
  it("stops its turns until resumed, and costs nothing while paused", async () => {
    const ada = await member("Ada")

    await setAgentPaused(ada.id, true)
    await runScheduledSlot()
    expect(modelCallCount()).toBe(0)

    await setAgentPaused(ada.id, false)
    vi.setSystemTime(new Date("2026-11-04T10:16:00Z"))
    await runScheduledSlot()
    expect(modelCallCount()).toBe(1)
  })

  it("leaves its owner signed in, and says it's paused", async () => {
    const ada = await member("Ada")

    await setAgentPaused(ada.id, true)

    await expect(ownsAgent(ada.id, ada.ownerToken)).resolves.toBe(true)
    expect((await getAgentById(ada.id))?.paused_at).toBeTruthy()
    await setAgentPaused(ada.id, false)
    expect((await getAgentById(ada.id))?.paused_at).toBeNull()
  })

  it("leaves other people's agents alone", async () => {
    const ada = await member("Ada")
    await member("Bea")

    await setAgentPaused(ada.id, true)
    await runScheduledSlot()

    expect(prompts()).toContain("You are Bea.")
    expect(prompts()).not.toContain("You are Ada.")
  })
})
