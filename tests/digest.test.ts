import { NextRequest } from "next/server"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { setDailyEmailAction, unsubscribeAction } from "@/app/actions"
import { POST as oneClick } from "@/app/api/unsubscribe/[token]/route"
import { GET as dailyRoute } from "@/app/api/daily-email/route"
import UnsubscribePage from "@/app/unsubscribe/[token]/page"
import { addOwnerWords } from "@/lib/conversations"
import { sendDailyEmails } from "@/lib/digest"
import { askToMeet, respondToIntroduction } from "@/lib/introductions"
import { createInvites, joinWithInvite } from "@/lib/members"
import { deleteAccount, removeContribution, setAgentPaused, setSuspended } from "@/lib/removal"
import { spawnAgent } from "./helpers/citizens"
import { failNextEmail, onNextEmail, sentEmails } from "./helpers/fake-email"
import { failNext, query } from "./helpers/fake-db"

const cookieJar = new Map<string, string>()

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
  }),
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

function at(iso: string) {
  vi.setSystemTime(new Date(iso))
}

async function member(name: string) {
  const email = `${name.toLowerCase()}@example.com`
  const { created } = await createInvites([email])
  const joined = await joinWithInvite({
    code: created[0].code,
    name,
    traits: ["curious", "bold", "loyal"],
    interests: "things",
    idea: `${name}'s idea, which is long enough.`,
    place: "commons",
  })
  return { ...joined, email }
}

const house = async (name: string) => {
  const agent = await spawnAgent({ handle: name.toLowerCase(), name, traits: ["calm"], backstory: "", goal: "A goal.", location: "commons" })
  await query(`UPDATE agents SET is_house = TRUE WHERE id = $1`, [agent.id])
  return agent
}

async function agentSays(agentId: string, conversationId: string, text: string) {
  const id = crypto.randomUUID()
  vi.setSystemTime(Date.now() + 1000)
  await query(
    `INSERT INTO contributions (id, conversation_id, agent_id, author_kind, move, text, guided, created_at)
     VALUES ($1, $2, $3, 'agent', 'challenge', $4, FALSE, $5)`,
    [id, conversationId, agentId, text, new Date().toISOString()],
  )
  return id
}

const emailsTo = (email: string) => sentEmails.filter((m) => m.to === email)
const tokenOf = async (email: string) =>
  (await query(`SELECT email_token::text AS token FROM members WHERE email = $1`, [email])).rows[0].token as string
const isOff = async (email: string) =>
  (await query(`SELECT email_off_at FROM members WHERE email = $1`, [email])).rows[0].email_off_at !== null

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  cookieJar.clear()
  vi.useFakeTimers({ toFake: ["Date"] })
  at("2026-11-04T08:00:00Z")
  vi.stubEnv("EMAIL_FROM", "hello@city.test")
  vi.stubEnv("AWS_EMAIL_ROLE_ARN", "arn:aws:iam::123456789012:role/email")
  vi.stubEnv("APP_URL", "https://city.test")
  vi.stubEnv("EMAIL_REPLY_TO", "founder@example.com")
  vi.stubEnv("CRON_SECRET", "cron-secret")
})

describe("the daily email", () => {
  it("waits for the day's hour, then says what happened", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    at("2026-11-04T09:00:00Z")
    await agentSays(mira.id, ada.conversationId, "What would a library need to lend tools?")

    at("2026-11-04T12:59:00Z")
    await expect(sendDailyEmails()).resolves.toMatchObject({ status: "early" })
    expect(sentEmails).toHaveLength(0)

    at("2026-11-04T13:00:00Z")
    await expect(sendDailyEmails()).resolves.toMatchObject({ status: "ran", sent: 1 })
    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].to).toBe(ada.email)
    expect(sentEmails[0].text).toContain("What would a library need to lend tools?")
    const { rows } = await query(`SELECT kind FROM product_events WHERE agent_id = $1`, [ada.id])
    expect(rows.map((r) => r.kind)).toContain("email_sent")
  })

  it("says who spoke and that an agent is an agent", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    const vela = await spawnAgent({ handle: "vela", name: "Vela", traits: ["calm"], backstory: "", goal: "A goal.", location: "commons" })
    await agentSays(mira.id, ada.conversationId, "From the house.")
    await agentSays(vela.id, ada.conversationId, "From an agent.")
    at("2026-11-04T08:10:00Z")
    const bea = await member("Bea")
    await addOwnerWords(bea.id, ada.conversationId, "From a person.")

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    const { text } = emailsTo(ada.email)[0]
    expect(text).toMatch(/Mira, a house agent, challenged/)
    expect(text).toMatch(/Vela, an AI agent, challenged/)
    expect(text).toMatch(/Bea's owner, in their own words/)
  })

  it("links every item to a contribution that exists", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    const first = await agentSays(mira.id, ada.conversationId, "One.")
    const second = await agentSays(mira.id, ada.conversationId, "Two.")

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    const links = [...sentEmails[0].text.matchAll(/https:\/\/city\.test\/conversation\/([\w-]+)#([\w-]+)/g)]
    expect(links.map((l) => l[2]).sort()).toEqual([first, second].sort())
    for (const [, conversationId, contributionId] of links) {
      const { rows } = await query(`SELECT 1 FROM contributions WHERE id = $1 AND conversation_id = $2`, [contributionId, conversationId])
      expect(rows).toHaveLength(1)
    }
  })

  it("sends nothing when nothing happened, and doesn't mention that day again", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")

    at("2026-11-04T13:00:00Z")
    await expect(sendDailyEmails()).resolves.toMatchObject({ sent: 0, quiet: 1 })
    expect(sentEmails).toHaveLength(0)

    at("2026-11-05T09:00:00Z")
    await agentSays(mira.id, ada.conversationId, "The next day's reply.")
    at("2026-11-05T13:00:00Z")
    await sendDailyEmails()

    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].text).toContain("The next day's reply.")
  })

  it("doesn't count someone's own words as news", async () => {
    const ada = await member("Ada")
    await addOwnerWords(ada.id, ada.conversationId, "My own words.")

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    expect(sentEmails).toHaveLength(0)
  })

  it("covers each thing once, with no gaps and no repeats", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "Monday's reply.")
    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    at("2026-11-04T13:30:00Z")
    await agentSays(mira.id, ada.conversationId, "Just after the email.")
    at("2026-11-05T13:00:00Z")
    await sendDailyEmails()

    expect(sentEmails).toHaveLength(2)
    expect(sentEmails[1].text).toContain("Just after the email.")
    expect(sentEmails[1].text).not.toContain("Monday's reply.")
  })

  it("leaves what arrives after the run started for the next email", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "Before the run.")
    const late = await agentSays(mira.id, ada.conversationId, "During the run.")
    await query(`UPDATE contributions SET created_at = '2026-11-04T13:00:30Z' WHERE id = $1`, [late])

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()
    expect(sentEmails[0].text).toContain("Before the run.")
    expect(sentEmails[0].text).not.toContain("During the run.")

    at("2026-11-05T13:00:00Z")
    await sendDailyEmails()
    expect(sentEmails[1].text).toContain("During the run.")
    expect(sentEmails[1].text).not.toContain("Before the run.")
  })

  it("loses nothing if a run dies after claiming someone but before they're emailed", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "A reply that must not be lost.")

    at("2026-11-04T13:00:00Z")
    failNextEmail()
    failNext(/UPDATE members SET digest_day = \$1 WHERE email/, "XX000")
    await sendDailyEmails()
    expect(sentEmails).toHaveLength(0)

    at("2026-11-05T13:00:00Z")
    await sendDailyEmails()
    expect(sentEmails[0].text).toContain("A reply that must not be lost.")
  })

  it("won't email someone who unsubscribed after the run began", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "To Ada.")
    await agentSays(mira.id, bea.conversationId, "To Bea.")
    onNextEmail(async (to) => {
      const other = to === ada.email ? bea.email : ada.email
      await query(`UPDATE members SET email_off_at = now() WHERE email = $1`, [other])
    })

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    expect(sentEmails).toHaveLength(1)
  })

  it("sends one email however many runs overlap", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "A reply.")

    at("2026-11-04T13:00:00Z")
    await Promise.all([sendDailyEmails(), sendDailyEmails(), sendDailyEmails()])
    await sendDailyEmails()

    expect(sentEmails).toHaveLength(1)
  })

  it("tries again on the next run if sending fails, with nothing lost", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "A reply worth keeping.")

    at("2026-11-04T13:00:00Z")
    failNextEmail()
    await expect(sendDailyEmails()).resolves.toMatchObject({ sent: 0, failed: 1 })

    at("2026-11-04T13:15:00Z")
    await expect(sendDailyEmails()).resolves.toMatchObject({ sent: 1, failed: 0 })
    expect(sentEmails[0].text).toContain("A reply worth keeping.")
  })

  it("one person's failure doesn't stop the next person's email", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "To Ada.")
    await agentSays(mira.id, bea.conversationId, "To Bea.")

    at("2026-11-04T13:00:00Z")
    failNextEmail()
    await expect(sendDailyEmails()).resolves.toMatchObject({ sent: 1, failed: 1 })
  })

  it("retries a write conflict on the claim", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "A reply.")

    at("2026-11-04T13:00:00Z")
    failNext(/UPDATE members\s+SET digest_day/)
    await expect(sendDailyEmails()).resolves.toMatchObject({ sent: 1 })
  })

  it("stops starting new emails near its time limit, and the next run carries on", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "To Ada.")
    await agentSays(mira.id, bea.conversationId, "To Bea.")

    at("2026-11-04T13:00:00Z")
    await expect(sendDailyEmails(Date.now() - 1)).resolves.toMatchObject({ sent: 0 })
    expect(sentEmails).toHaveLength(0)

    await expect(sendDailyEmails()).resolves.toMatchObject({ sent: 2 })
  })

  it.each(["EMAIL_FROM", "AWS_EMAIL_ROLE_ARN", "APP_URL", "EMAIL_REPLY_TO"])("does nothing without %s", async (name) => {
    vi.stubEnv(name, "")
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "A reply.")

    at("2026-11-04T13:00:00Z")
    await expect(sendDailyEmails()).resolves.toEqual({ status: "off" })
    expect(sentEmails).toHaveLength(0)
  })

  it("keeps withdrawn and removed words out", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    const removed = await agentSays(mira.id, ada.conversationId, "Something about a walrus.")
    await agentSays(mira.id, ada.conversationId, "Something kept.")
    await removeContribution(removed)

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    expect(sentEmails[0].text).toContain("Something kept.")
    expect(sentEmails[0].text).not.toContain("walrus")
    expect(sentEmails[0].text).not.toContain(removed)
  })

  it("keeps a suspended person's words out, and doesn't write to them", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    await addOwnerWords(bea.id, ada.conversationId, "Words from someone suspended.")
    const mira = await house("Mira")
    await agentSays(mira.id, bea.conversationId, "A reply to Bea.")

    await setSuspended(bea.id, true)
    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    expect(emailsTo(bea.email)).toHaveLength(0)
    expect(JSON.stringify(emailsTo(ada.email))).not.toContain("Words from someone suspended.")
  })

  it("never writes to someone who deleted their account", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "A reply.")

    await deleteAccount(ada.id)
    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    expect(sentEmails).toHaveLength(0)
  })

  it("still writes while an agent is paused, since people are still talking", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "A reply.")

    await setAgentPaused(ada.id, true)
    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    expect(sentEmails).toHaveLength(1)
  })

  it("shows a long reply cut short, and says when there's more", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    for (let i = 0; i < 6; i++) await agentSays(mira.id, ada.conversationId, `Reply ${i}.`)
    await agentSays(mira.id, ada.conversationId, `${"long ".repeat(100)}END-OF-TEXT`)

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    expect(sentEmails[0].text).toContain("long long")
    expect(sentEmails[0].text).not.toContain("END-OF-TEXT")
    expect(sentEmails[0].text).toMatch(/and 2 more/)
    expect(sentEmails[0].text).toContain("https://city.test/\n")
  })

  it("doesn't carry a line of someone's words into the subject", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "A reply about a walrus.")

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    expect(sentEmails[0].subject).toBe("1 new in your Mindworld conversations")
  })
})

describe("introductions in the daily email", () => {
  it("tells someone they were asked, once", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    at("2026-11-04T08:30:00Z")
    await askToMeet(bea.id, ada.id, "bea-contact-detail")

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    const { subject, text } = emailsTo(ada.email)[0]
    expect(subject).toBe("Someone asked to meet you in Mindworld")
    expect(text).toMatch(/Bea's owner asked to meet you/)
    expect(text).toContain("https://city.test/connections")
    expect(text).not.toContain("bea-contact-detail")

    at("2026-11-05T13:00:00Z")
    await sendDailyEmails()
    expect(emailsTo(ada.email)).toHaveLength(1)
  })

  it("leaves an introduction that arrives during the run for the next email", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    at("2026-11-04T08:30:00Z")
    await askToMeet(bea.id, ada.id, "bea-contact-detail")
    await query(`UPDATE introductions SET created_at = '2026-11-04T13:00:30Z'`)

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()
    expect(emailsTo(ada.email)).toHaveLength(0)

    at("2026-11-05T13:00:00Z")
    await sendDailyEmails()
    expect(emailsTo(ada.email)[0].text).toMatch(/Bea's owner asked to meet you/)
  })

  it("leaves an acceptance that arrives during the run for the next email", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    at("2026-11-04T08:30:00Z")
    await askToMeet(bea.id, ada.id, "bea-contact-detail")
    await respondToIntroduction(ada.id, bea.id, true, "ada-contact-detail")
    await query(`UPDATE introductions SET responded_at = '2026-11-04T13:00:30Z'`)

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()
    expect(emailsTo(bea.email)).toHaveLength(0)

    at("2026-11-05T13:00:00Z")
    await sendDailyEmails()
    expect(emailsTo(bea.email)[0].text).toMatch(/Ada's owner accepted/)
  })

  it("tells someone they were accepted, without the contact", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    await askToMeet(bea.id, ada.id, "bea-contact-detail")
    at("2026-11-04T09:00:00Z")
    await respondToIntroduction(ada.id, bea.id, true, "ada-contact-detail")

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    const { text } = emailsTo(bea.email)[0]
    expect(text).toMatch(/Ada's owner accepted/)
    expect(text).not.toContain("ada-contact-detail")
  })

  it("never tells someone they were declined", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    await askToMeet(bea.id, ada.id, "bea-contact-detail")
    at("2026-11-04T09:00:00Z")
    await respondToIntroduction(ada.id, bea.id, false)

    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()

    expect(emailsTo(bea.email)).toHaveLength(0)
  })
})

describe("turning the email off", () => {
  async function emailed() {
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "A reply.")
    at("2026-11-04T13:00:00Z")
    await sendDailyEmails()
    return { ada, mira, token: await tokenOf(ada.email) }
  }

  it("carries a link and one-click headers, unique to the person", async () => {
    const { token } = await emailed()

    expect(sentEmails[0].text).toContain(`https://city.test/unsubscribe/${token}`)
    expect(sentEmails[0].headers).toEqual([
      { Name: "List-Unsubscribe", Value: `<https://city.test/api/unsubscribe/${token}>` },
      { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
    ])
  })

  it("isn't turned off by something merely opening the link, which mail scanners do", async () => {
    const { ada, token } = await emailed()

    const html = renderToStaticMarkup(await UnsubscribePage({ params: Promise.resolve({ token }) }))

    expect(html).toMatch(/<button/)
    await expect(isOff(ada.email)).resolves.toBe(false)
  })

  it("stops with the page's button", async () => {
    const { ada, mira, token } = await emailed()

    await unsubscribeAction(form({ token })).catch((err) => {
      if (!String(err.digest).includes("/unsubscribe/done")) throw err
    })

    await expect(isOff(ada.email)).resolves.toBe(true)
    at("2026-11-05T09:00:00Z")
    await agentSays(mira.id, ada.conversationId, "Another reply.")
    at("2026-11-05T13:00:00Z")
    await sendDailyEmails()
    expect(sentEmails).toHaveLength(1)
  })

  it("stops with a mail client's one-click request, with no cookie", async () => {
    const { ada, token } = await emailed()

    const res = await oneClick(new NextRequest(`https://city.test/api/unsubscribe/${token}`, { method: "POST" }), {
      params: Promise.resolve({ token }),
    })

    expect(res.status).toBe(200)
    await expect(isOff(ada.email)).resolves.toBe(true)
  })

  it("answers the same for a token that doesn't exist, and changes nothing", async () => {
    const { ada } = await emailed()

    for (const token of [crypto.randomUUID(), "not-a-token"]) {
      const res = await oneClick(new NextRequest(`https://city.test/api/unsubscribe/${token}`, { method: "POST" }), {
        params: Promise.resolve({ token }),
      })
      expect(res.status).toBe(200)
    }

    await expect(isOff(ada.email)).resolves.toBe(false)
    expect(console.error).not.toHaveBeenCalled()
  })

  it("never shows whose address it is", async () => {
    const { ada, token } = await emailed()

    const html = renderToStaticMarkup(await UnsubscribePage({ params: Promise.resolve({ token }) }))

    expect(html).not.toContain(ada.email)
    expect(html).not.toContain("Ada")
  })

  it("can be switched off and back on from My agent, only for yourself", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    cookieJar.set(`polis-own-${ada.id}`, ada.ownerToken)

    await setDailyEmailAction(form({ on: "0", agentId: bea.id, email: bea.email }))
    await expect(isOff(ada.email)).resolves.toBe(true)
    await expect(isOff(bea.email)).resolves.toBe(false)

    await setDailyEmailAction(form({ on: "1" }))
    await expect(isOff(ada.email)).resolves.toBe(false)
  })

  it("does nothing for someone signed out", async () => {
    const ada = await member("Ada")

    await setDailyEmailAction(form({ on: "0" }))

    await expect(isOff(ada.email)).resolves.toBe(false)
  })
})

describe("GET /api/daily-email", () => {
  const request = (secret: string | null) =>
    new Request("https://city.test/api/daily-email", { headers: secret ? { authorization: `Bearer ${secret}` } : {} })

  it("needs the scheduler's secret", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "A reply.")
    at("2026-11-04T13:00:00Z")

    expect((await dailyRoute(request(null))).status).toBe(401)
    expect((await dailyRoute(request("wrong"))).status).toBe(401)
    expect(sentEmails).toHaveLength(0)
  })

  it("runs and says what it did", async () => {
    const ada = await member("Ada")
    const mira = await house("Mira")
    await agentSays(mira.id, ada.conversationId, "A reply.")
    at("2026-11-04T13:00:00Z")

    const res = await dailyRoute(request("cron-secret"))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, status: "ran", sent: 1 })
  })

  it("reports a failure without saying what's in the database", async () => {
    at("2026-11-04T13:00:00Z")
    failNext(/FROM members/, "XX000")

    const res = await dailyRoute(request("cron-secret"))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ ok: false })
  })
})
