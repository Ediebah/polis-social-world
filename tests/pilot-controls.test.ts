import { NextRequest } from "next/server"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  addWordsAction,
  acceptIntroductionAction,
  askToMeetAction,
  deleteAccountAction,
  guideAction,
  joinAction,
  setPausedAction,
  shareIdeaAction,
  withdrawIdeaAction,
  withdrawWordsAction,
} from "@/app/actions"
import { GET as citymap } from "@/app/api/citymap/route"
import { GET as feed } from "@/app/api/feed/route"
import { GET as journal } from "@/app/api/journal/[id]/route"
import { GET as search } from "@/app/api/search/route"
import AgentPage from "@/app/agent/[id]/page"
import HomePage from "@/app/page"
import PrivacyPage from "@/app/privacy/page"
import { ContributionItem } from "@/components/contribution-item"
import { getBriefing } from "@/lib/briefing"
import { withoutSecrets } from "@/lib/format"
import { addOwnerWords, getConversation, getOwnIdeas, listOpenConversations } from "@/lib/conversations"
import { askToMeet, getIntroductions } from "@/lib/introductions"
import { createInvites, joinWithInvite } from "@/lib/members"
import { getAgentById, getAgentEvents, getFeed, ownsAgent } from "@/lib/queries"
import { setAgentPaused, setSuspended } from "@/lib/removal"
import type { ContributionView } from "@/lib/types"
import { failNext, query } from "./helpers/fake-db"
import { spawnAgent } from "./helpers/citizens"

const cookieJar = new Map<string, string>()

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: () => {},
}))

async function member(name: string, idea = `${name}'s idea, which is long enough.`) {
  const email = `${name.toLowerCase()}@example.com`
  const { created } = await createInvites([email])
  const joined = await joinWithInvite({
    code: created[0].code,
    name,
    traits: ["curious", "bold", "loyal"],
    interests: "things",
    idea,
    place: "commons",
  })
  return { ...joined, email }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const signIn = (who: { id: string; ownerToken: string }) => cookieJar.set(`polis-own-${who.id}`, who.ownerToken)
const later = (minutes: number) => vi.setSystemTime(Date.now() + minutes * 60_000)
const eventsOf = async (agentId: string) =>
  (await query(`SELECT kind FROM product_events WHERE agent_id = $1`, [agentId])).rows.map((r) => r.kind as string)

// The words in a page's elements, without rendering the async parts inside it.
function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(" ")
  const props = (node as { props?: { children?: unknown } } | null)?.props
  return props ? textOf(props.children) : ""
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  try {
    await run
  } catch (err) {
    const digest = String((err as { digest?: string }).digest ?? "")
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2]
    throw err
  }
  throw new Error("expected a redirect")
}

beforeEach(() => {
  cookieJar.clear()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-04T10:00:00Z"))
})

describe("people's controls act only on their own things", () => {
  it("won't withdraw someone else's idea, whatever the form says", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const ideaId = (await getConversation(ada.conversationId))?.idea?.id as string
    signIn(bea)

    await withdrawIdeaAction(form({ ideaId, agentId: ada.id }))

    expect((await getConversation(ada.conversationId))?.idea?.text).toBeTruthy()
    expect(await eventsOf(bea.id)).not.toContain("withdrew")
  })

  it("won't withdraw someone else's words", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const { id } = await addOwnerWords(ada.id, ada.conversationId, "Ada's own words.")
    signIn(bea)

    await withdrawWordsAction(form({ contributionId: id, conversationId: ada.conversationId }))

    expect((await getConversation(ada.conversationId))?.contributions[0].text).toBe("Ada's own words.")
  })

  it("withdraws your own, and counts it", async () => {
    const ada = await member("Ada")
    const ideaId = (await getConversation(ada.conversationId))?.idea?.id as string
    const { id } = await addOwnerWords(ada.id, ada.conversationId, "Ada's own words.")
    signIn(ada)

    await withdrawWordsAction(form({ contributionId: id, conversationId: ada.conversationId }))
    await withdrawIdeaAction(form({ ideaId }))

    const room = await getConversation(ada.conversationId)
    expect(room?.contributions[0].text).toBe("")
    expect(room?.idea?.text).toBe("")
    expect((await eventsOf(ada.id)).filter((k) => k === "withdrew")).toHaveLength(2)
  })

  it("pauses the citizen you're signed in as, not one named in the form", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    signIn(ada)

    await setPausedAction(form({ paused: "1", agentId: bea.id }))
    expect((await getAgentById(ada.id))?.paused_at).toBeTruthy()
    expect((await getAgentById(bea.id))?.paused_at).toBeNull()

    await setPausedAction(form({ paused: "0" }))
    expect((await getAgentById(ada.id))?.paused_at).toBeNull()
  })

  it("does nothing for someone signed out", async () => {
    const ada = await member("Ada")
    const ideaId = (await getConversation(ada.conversationId))?.idea?.id as string

    await withdrawIdeaAction(form({ ideaId }))
    await setPausedAction(form({ paused: "1" }))

    expect((await getConversation(ada.conversationId))?.idea?.text).toBeTruthy()
    expect((await getAgentById(ada.id))?.paused_at).toBeNull()
  })
})

describe("deleting your account from the page", () => {
  it("needs the agent's exact name, and otherwise changes nothing", async () => {
    const ada = await member("Ada")
    signIn(ada)

    for (const confirm of ["", "ada", "Bea"]) {
      await expect(deleteAccountAction({}, form({ confirm }))).resolves.toEqual({ error: expect.stringContaining("Ada") })
    }

    await expect(ownsAgent(ada.id, ada.ownerToken)).resolves.toBe(true)
  })

  it("deletes the person signed in, signs them out, and says so", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    signIn(ada)

    await expect(redirectOf(deleteAccountAction({}, form({ confirm: "Ada", agentId: bea.id })))).resolves.toBe("/join?deleted=1")

    expect(await getAgentById(ada.id)).toMatchObject({ status: "deleted" })
    await expect(ownsAgent(bea.id, bea.ownerToken)).resolves.toBe(true)
    expect([...cookieJar.keys()]).toEqual([])
  })

  it("does nothing for someone signed out", async () => {
    const ada = await member("Ada")

    await expect(deleteAccountAction({}, form({ confirm: "Ada" }))).resolves.toMatchObject({ error: expect.any(String) })

    await expect(ownsAgent(ada.id, ada.ownerToken)).resolves.toBe(true)
  })

  it("says nothing was deleted if it fails, and keeps them signed in", async () => {
    const ada = await member("Ada")
    signIn(ada)
    failNext(/DELETE FROM members/, "XX000")

    await expect(deleteAccountAction({}, form({ confirm: "Ada" }))).resolves.toEqual({ error: expect.stringMatching(/nothing was deleted/) })

    expect(cookieJar.size).toBe(1)
    await expect(ownsAgent(ada.id, ada.ownerToken)).resolves.toBe(true)
  })
})

describe("nobody can reach another person's address or sign-in", () => {
  it("never returns them from anything a member can read", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    await addOwnerWords(ada.id, bea.conversationId, "Ada's words here.")
    later(1)
    await askToMeet(ada.id, bea.id, "ada-contact-detail")
    signIn(bea)
    const asMember = (url: string) =>
      new NextRequest(`https://city.test${url}`, { headers: { cookie: `polis-own-${bea.id}=${bea.ownerToken}` } })
    const context = { params: Promise.resolve({ id: ada.id }) }

    const responses = await Promise.all([
      feed(asMember("/api/feed"), context as never),
      search(asMember("/api/search?q=Ada"), context as never),
      citymap(asMember("/api/citymap"), context as never),
      journal(asMember(`/api/journal/${ada.id}`), context),
    ])
    const seen = JSON.stringify([
      await Promise.all(responses.map((r) => r.json())),
      await getConversation(bea.conversationId),
      await getAgentById(ada.id),
      await getAgentEvents(ada.id),
      await getFeed(),
      await listOpenConversations(),
      await getBriefing(bea.id),
      await getOwnIdeas(bea.id),
      await getIntroductions(bea.id),
    ])

    expect(seen).toContain("Ada")
    expect(seen).not.toContain(ada.email)
    expect(seen).not.toContain(ada.ownerToken)
    expect(seen).not.toContain("ada-contact-detail")
  })
})

describe("what gets counted", () => {
  it("counts joining", async () => {
    const { created } = await createInvites(["cal@example.com"])
    const place = form({ code: created[0].code, name: "Cal", interests: "things", idea: "An idea that's long enough.", place: "commons" })
    for (const trait of ["curious", "bold", "loyal"]) place.append("traits", trait)

    await redirectOf(joinAction({}, place))

    const { rows } = await query(`SELECT agent_id::text AS id FROM product_events WHERE kind = 'joined'`)
    expect(rows).toHaveLength(1)
  })

  it("counts sharing, words, guiding, asking and connecting, for whoever did them", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    signIn(ada)

    await shareIdeaAction({}, form({ agentId: ada.id, place: "commons", text: "Another idea worth sharing." }))
    later(1)
    await addWordsAction({}, form({ agentId: ada.id, conversationId: bea.conversationId, text: "My words." }))
    await guideAction(form({ conversationId: bea.conversationId, move: "question" }))
    later(1)
    await askToMeetAction({}, form({ agentId: bea.id, contact: "ada-contact" }))

    expect((await eventsOf(ada.id)).sort()).toEqual(["ask_to_meet", "guide", "idea", "words"])

    cookieJar.clear()
    signIn(bea)
    await acceptIntroductionAction({}, form({ agentId: ada.id, contact: "bea-contact" }))
    expect(await eventsOf(bea.id)).toContain("intro_connected")
  })

  it("doesn't count what was refused", async () => {
    const ada = await member("Ada")
    signIn(ada)

    await addWordsAction({}, form({ agentId: ada.id, conversationId: crypto.randomUUID(), text: "My words." }))
    await guideAction(form({ conversationId: crypto.randomUUID(), move: "question" }))
    await shareIdeaAction({}, form({ agentId: ada.id, place: "commons", text: "short" }))

    expect(await eventsOf(ada.id)).toEqual([])
  })

  it("counts seeing a briefing only when there's something in it", async () => {
    const ada = await member("Ada")
    const mira = await spawnAgent({ handle: "mira", name: "Mira", traits: ["calm"], backstory: "", goal: "A goal.", location: "commons" })
    signIn(ada)

    await HomePage()
    expect(await eventsOf(ada.id)).not.toContain("briefing_seen")

    later(1)
    await query(
      `INSERT INTO contributions (id, conversation_id, agent_id, author_kind, move, text, guided, created_at)
       VALUES ($1, $2, $3, 'agent', 'question', 'A reply.', FALSE, $4)`,
      [crypto.randomUUID(), ada.conversationId, mira.id, new Date().toISOString()],
    )
    await HomePage()
    expect(await eventsOf(ada.id)).toContain("briefing_seen")
  })
})

describe("how a contribution shows up", () => {
  const base: ContributionView = {
    id: crypto.randomUUID(),
    agent_id: crypto.randomUUID(),
    agent_name: "Vela",
    is_house: false,
    author_kind: "agent",
    move: "question",
    guided: false,
    text: "What would it take?",
    created_at: "2026-11-04T09:00:00Z",
    remembered_from: null,
    remembered_text: null,
  }
  const ME = crypto.randomUUID()
  const render = (item: ContributionView) => renderToStaticMarkup(createElement(ContributionItem, { item, memberId: ME, conversationId: crypto.randomUUID() }))

  it("shows nothing to act on once it's gone, not even whose it was", () => {
    const html = render({ ...base, text: "" })

    expect(html).toContain("no longer here")
    expect(html).not.toContain("Vela")
    expect(html).not.toContain("Report")
    expect(html).not.toContain("/meet/")
    expect(html).not.toContain("/agent/")
  })

  it("lets you report another agent and ask to meet its owner", () => {
    const html = render(base)

    expect(html).toContain("Report")
    expect(html).toContain("/meet/")
    expect(html).not.toContain("Withdraw")
  })

  it("lets you report a house agent, with nobody to meet", () => {
    const html = render({ ...base, is_house: true })

    expect(html).toContain("Report")
    expect(html).not.toContain("/meet/")
  })

  it("lets you report your own agent, with nobody to meet", () => {
    const html = render({ ...base, agent_id: ME })

    expect(html).toContain("Report")
    expect(html).not.toContain("/meet/")
    expect(html).not.toContain("Withdraw")
  })

  it("lets you report someone else's own words, not withdraw them", () => {
    const html = render({ ...base, author_kind: "owner" })

    expect(html).toContain("Report")
    expect(html).not.toContain("Withdraw")
  })

  it("lets you withdraw your own words, rather than report them", () => {
    const html = render({ ...base, agent_id: ME, author_kind: "owner" })

    expect(html).toContain("Withdraw your words")
    expect(html).not.toContain("Report")
  })
})

describe("an agent's page", () => {
  it("shows nothing about someone suspended, and says the same as for someone gone", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    await setSuspended(ada.id, true)
    signIn(bea)

    const shown = JSON.stringify(await AgentPage({ params: Promise.resolve({ id: ada.id }) }))

    expect(shown).toContain("No longer active")
    expect(shown).not.toContain("Ada")
    expect(shown).not.toContain("things")
  })

  it("writes no journal for someone who isn't active", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    await setSuspended(ada.id, true)

    const res = await journal(
      new NextRequest(`https://city.test/api/journal/${ada.id}`, { headers: { cookie: `polis-own-${bea.id}=${bea.ownerToken}` } }),
      { params: Promise.resolve({ id: ada.id }) },
    )

    await expect(res.json()).resolves.toEqual({ journal: "", lastEventAt: null })
  })

  it("says when an agent is paused", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    await setAgentPaused(ada.id, true)
    signIn(bea)

    expect(textOf(await AgentPage({ params: Promise.resolve({ id: ada.id }) }))).toContain("Paused by its owner")
  })
})

describe("analytics", () => {
  it.each(["join", "login", "unsubscribe"])("never sees the secret in a /%s/ link", (path) => {
    expect(withoutSecrets(`https://city.test/${path}/a-secret-token?x=1`)).toBe(`https://city.test/${path}/[hidden]?x=1`)
  })
})

describe("the privacy page", () => {
  const html = () => renderToStaticMarkup(PrivacyPage())

  it("names everyone who processes the data", () => {
    for (const provider of ["Anthropic", "Amazon Web Services", "Vercel", "GitHub"]) expect(html()).toContain(provider)
  })

  it.each(["Who can see what", "How long it", "Delete your account", "Withdraw an idea", "Pause your agent", "Stop the daily email", "What can"])("covers %s", (topic) => {
    expect(html()).toContain(topic)
  })

  it("is honest about what can't be taken back", () => {
    expect(html()).toMatch(/reworded/)
    expect(html()).toMatch(/already sent/)
  })
})
