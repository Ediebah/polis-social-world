import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { reportAction } from "@/app/actions"
import { GET as metricsRoute } from "@/app/api/admin/metrics/route"
import { POST as moderateRoute } from "@/app/api/admin/moderate/route"
import { GET as reportsRoute } from "@/app/api/admin/reports/route"
import { addOwnerWords, getConversation } from "@/lib/conversations"
import { noteVisit, recordEvent } from "@/lib/events"
import { createInvites, joinWithInvite, requireMember } from "@/lib/members"
import { getPilotMetrics } from "@/lib/metrics"
import { getAgentById, ownsAgent } from "@/lib/queries"
import { deleteAccount, withdrawIdea } from "@/lib/removal"
import { fileReport, MAX_REPORTS_PER_DAY, ReportError } from "@/lib/reports"
import { failNextEmail, sentEmails } from "./helpers/fake-email"
import { failNext, query } from "./helpers/fake-db"

const cookieJar = new Map<string, string>()
const afterCalls: (() => unknown)[] = []

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
  }),
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => afterCalls.push(fn),
}))

const SECRET = "admin-secret"

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

async function agentSays(agentId: string, conversationId: string, text: string) {
  const id = crypto.randomUUID()
  await query(
    `INSERT INTO contributions (id, conversation_id, agent_id, author_kind, move, text, guided, created_at)
     VALUES ($1, $2, $3, 'agent', 'challenge', $4, FALSE, now())`,
    [id, conversationId, agentId, text],
  )
  return id
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const signIn = (who: { id: string; ownerToken: string }) => cookieJar.set(`polis-own-${who.id}`, who.ownerToken)
const count = async (table: string) => (await query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number
const runAfter = async () => {
  for (const fn of afterCalls.splice(0)) await fn()
}

function admin(url: string, body?: unknown, secret: string | null = SECRET) {
  return new NextRequest(`https://city.test${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  cookieJar.clear()
  afterCalls.length = 0
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-04T10:00:00Z"))
  vi.stubEnv("EMAIL_FROM", "hello@city.test")
  vi.stubEnv("AWS_EMAIL_ROLE_ARN", "arn:aws:iam::123456789012:role/email")
  vi.stubEnv("APP_URL", "https://city.test")
  vi.stubEnv("EMAIL_REPLY_TO", "founder@example.com")
  vi.stubEnv("ADMIN_SECRET", SECRET)
})

describe("reporting something", () => {
  it("emails the founder what was said, who reported it and why, and how to act", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const said = await agentSays(ada.id, bea.conversationId, "Bea's owner is a fraud.")
    signIn(bea)

    const state = await reportAction({}, form({ contributionId: said, reason: "harmful", note: "This isn't true." }))
    await runAfter()

    expect(state).toEqual({ ok: true })
    expect(sentEmails).toHaveLength(1)
    const { to, subject, text } = sentEmails[0]
    expect(to).toBe("founder@example.com")
    expect(subject).toBe("A report in Mindworld")
    expect(text).toContain("Bea's owner is a fraud.")
    expect(text).toContain("This isn't true.")
    expect(text).toMatch(/Reported by Bea's owner/)
    expect(text).toContain(`https://city.test/conversation/${bea.conversationId}#${said}`)
    expect(text).toContain(said)
    expect(text).toContain(ada.id)
  })

  it("never puts anyone's address in the report", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const said = await agentSays(ada.id, bea.conversationId, "Something.")
    signIn(bea)

    await reportAction({}, form({ contributionId: said, reason: "other" }))
    await runAfter()

    expect(sentEmails[0].text).not.toContain(ada.email)
    expect(sentEmails[0].text).not.toContain(bea.email)
  })

  it("lets someone report their own agent misrepresenting them", async () => {
    const ada = await member("Ada")
    const said = await agentSays(ada.id, ada.conversationId, "My owner secretly hates libraries.")
    signIn(ada)

    await expect(reportAction({}, form({ contributionId: said, reason: "misrepresents_me" }))).resolves.toEqual({ ok: true })
  })

  it("has nothing to report in your own idea", async () => {
    const ada = await member("Ada")
    const ideaId = (await getConversation(ada.conversationId))?.idea?.id as string
    signIn(ada)

    await expect(reportAction({}, form({ ideaId, reason: "other" }))).resolves.toMatchObject({ error: expect.any(String) })
    expect(await count("reports")).toBe(0)
  })

  it("has nothing to report in your own words", async () => {
    const ada = await member("Ada")
    const { id } = await addOwnerWords(ada.id, ada.conversationId, "My own words.")
    signIn(ada)

    await expect(reportAction({}, form({ contributionId: id, reason: "other" }))).resolves.toMatchObject({ error: expect.any(String) })
    expect(await count("reports")).toBe(0)
  })

  it("covers ideas and agents as well", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const ideaId = (await getConversation(ada.conversationId))?.idea?.id as string
    signIn(bea)

    await expect(reportAction({}, form({ ideaId, reason: "harmful" }))).resolves.toEqual({ ok: true })
    await expect(reportAction({}, form({ agentId: ada.id, reason: "harmful" }))).resolves.toEqual({ ok: true })
    await runAfter()

    expect(sentEmails[0].text).toContain("Ada's idea, which is long enough.")
    expect(sentEmails[1].text).toMatch(/Ada, an AI agent/)
    expect(await count("reports")).toBe(2)
  })

  it("keeps the report if the email fails, so it can be read later", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const said = await agentSays(ada.id, bea.conversationId, "Something.")
    signIn(bea)
    failNextEmail()

    await expect(reportAction({}, form({ contributionId: said, reason: "other" }))).resolves.toEqual({ ok: true })
    await runAfter()

    expect(await count("reports")).toBe(1)
    expect(sentEmails).toHaveLength(0)
  })

  it("still stores it with no mailbox set", async () => {
    vi.stubEnv("EMAIL_REPLY_TO", "")
    const ada = await member("Ada")
    signIn(ada)
    const bea = await member("Bea")

    await reportAction({}, form({ agentId: bea.id, reason: "other" }))
    await runAfter()

    expect(await count("reports")).toBe(1)
    expect(sentEmails).toHaveLength(0)
  })

  it("keeps no copy of the words, so withdrawing them leaves none behind", async () => {
    const ada = await member("Ada", "An idea about zebra-striped-tools for all.")
    const bea = await member("Bea")
    const ideaId = (await getConversation(ada.conversationId))?.idea?.id as string
    signIn(bea)
    await reportAction({}, form({ ideaId, reason: "other" }))

    await withdrawIdea(ada.id, ideaId)

    const { rows } = await query(`SELECT * FROM reports`)
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain("zebra-striped-tools")
  })

  it("has to be from a member", async () => {
    const ada = await member("Ada")

    await expect(reportAction({}, form({ agentId: ada.id, reason: "other" }))).resolves.toMatchObject({ error: expect.any(String) })
    expect(await count("reports")).toBe(0)
  })

  it("files it as whoever is signed in, whatever the form says", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    signIn(bea)

    await reportAction({}, form({ agentId: ada.id, reason: "other", reporterId: ada.id }))

    const { rows } = await query(`SELECT reporter_id::text AS id FROM reports`)
    expect(rows[0].id).toBe(bea.id)
  })

  it.each([
    ["an unknown reason", { reason: "nonsense" }, /Pick a reason/],
    ["a note that's too long", { reason: "other", note: "x".repeat(501) }, /too long/],
  ])("refuses %s and keeps what was typed", async (_what, fields, message) => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    signIn(bea)

    const state = await reportAction({}, form({ agentId: ada.id, ...fields }))

    expect(state.error).toMatch(message)
    expect(state.note).toBe((fields as { note?: string }).note ?? "")
    expect(await count("reports")).toBe(0)
  })

  it.each([
    ["nothing", {}],
    ["a contribution that doesn't exist", { contributionId: crypto.randomUUID() }],
    ["an idea that doesn't exist", { ideaId: crypto.randomUUID() }],
    ["an agent that doesn't exist", { agentId: crypto.randomUUID() }],
    ["something that isn't an id", { contributionId: "1 OR 1=1" }],
  ])("refuses a report about %s", async (_what, fields) => {
    const bea = await member("Bea")
    signIn(bea)

    await expect(reportAction({}, form({ reason: "other", ...fields }))).resolves.toMatchObject({ error: expect.any(String) })
    expect(await count("reports")).toBe(0)
  })

  it("limits how many one person can send in a day", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")

    for (let i = 0; i < MAX_REPORTS_PER_DAY; i++) await fileReport(bea.id, { agentId: ada.id }, "other", "")
    await expect(fileReport(bea.id, { agentId: ada.id }, "other", "")).rejects.toBeInstanceOf(ReportError)

    vi.setSystemTime(new Date("2026-11-05T10:01:00Z"))
    await expect(fileReport(bea.id, { agentId: ada.id }, "other", "")).resolves.toBeTruthy()
  })

  it("says something went wrong if it couldn't be stored", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    signIn(bea)
    failNext(/INSERT INTO reports/, "XX000")

    await expect(reportAction({}, form({ agentId: ada.id, reason: "other", note: "Keep this." }))).resolves.toMatchObject({
      error: expect.stringMatching(/went wrong/),
      note: "Keep this.",
    })
  })
})

describe("what the founder can do", () => {
  it("reads open reports, with what's there now", async () => {
    const ada = await member("Ada", "An idea about zebra-striped-tools for all.")
    const bea = await member("Bea")
    const ideaId = (await getConversation(ada.conversationId))?.idea?.id as string
    const said = await agentSays(ada.id, bea.conversationId, "Something awful.")
    await fileReport(bea.id, { contributionId: said }, "harmful", "Please look.")
    await fileReport(bea.id, { ideaId }, "other", "")

    const res = await reportsRoute(admin("/api/admin/reports"))

    expect(res.status).toBe(200)
    const { reports } = await res.json()
    expect(reports).toHaveLength(2)
    expect(reports.find((r: { contribution_id: string }) => r.contribution_id === said)).toMatchObject({
      reason: "harmful",
      note: "Please look.",
      reporter_name: "Bea",
      agent_id: ada.id,
      agent_name: "Ada",
      text: "Something awful.",
      conversation_id: bea.conversationId,
    })

    await withdrawIdea(ada.id, ideaId)
    const after = await (await reportsRoute(admin("/api/admin/reports"))).json()
    expect(JSON.stringify(after)).not.toContain("zebra-striped-tools")
  })

  it("never lists anyone's address", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    await fileReport(bea.id, { agentId: ada.id }, "other", "")

    const body = JSON.stringify(await (await reportsRoute(admin("/api/admin/reports"))).json())

    expect(body).not.toContain("@example.com")
  })

  it("suspends and restores", async () => {
    const ada = await member("Ada")

    const res = await moderateRoute(admin("/api/admin/moderate", { action: "suspend", agentId: ada.id }))
    await expect(res.json()).resolves.toEqual({ ok: true, changed: true })
    await expect(ownsAgent(ada.id, ada.ownerToken)).resolves.toBe(false)

    await moderateRoute(admin("/api/admin/moderate", { action: "restore", agentId: ada.id }))
    await expect(ownsAgent(ada.id, ada.ownerToken)).resolves.toBe(true)
  })

  it("removes words and ideas", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const said = await agentSays(ada.id, bea.conversationId, "Something awful.")
    const ideaId = (await getConversation(ada.conversationId))?.idea?.id as string

    await moderateRoute(admin("/api/admin/moderate", { action: "remove", contributionId: said }))
    await moderateRoute(admin("/api/admin/moderate", { action: "remove", ideaId }))

    expect((await getConversation(bea.conversationId))?.contributions[0].text).toBe("")
    expect((await getConversation(ada.conversationId))?.idea?.text).toBe("")
  })

  it("deletes an account someone asked to have deleted", async () => {
    const ada = await member("Ada")

    await moderateRoute(admin("/api/admin/moderate", { action: "delete", agentId: ada.id }))

    expect(await getAgentById(ada.id)).toMatchObject({ status: "deleted" })
  })

  it("marks a report as dealt with, which takes it off the list", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    const { id } = await fileReport(bea.id, { agentId: ada.id }, "other", "")

    const res = await moderateRoute(admin("/api/admin/moderate", { action: "resolve", reportId: id }))

    await expect(res.json()).resolves.toEqual({ ok: true, changed: true })
    const { reports } = await (await reportsRoute(admin("/api/admin/reports"))).json()
    expect(reports).toEqual([])

    const again = await moderateRoute(admin("/api/admin/moderate", { action: "resolve", reportId: id }))
    await expect(again.json()).resolves.toEqual({ ok: true, changed: false })
  })

  it("says when nothing changed", async () => {
    const res = await moderateRoute(admin("/api/admin/moderate", { action: "suspend", agentId: crypto.randomUUID() }))

    await expect(res.json()).resolves.toEqual({ ok: true, changed: false })
  })

  it.each([
    [{ action: "explode", agentId: "x" }],
    [{ action: "suspend" }],
    [{ action: "remove" }],
    [{ action: "resolve", reportId: "not-an-id" }],
    [null],
  ])("refuses %j", async (body) => {
    const res = await moderateRoute(admin("/api/admin/moderate", body))

    expect(res.status).toBe(400)
  })

  it.each([
    ["GET /api/admin/reports", () => reportsRoute(admin("/api/admin/reports", undefined, null))],
    ["GET /api/admin/reports with a wrong secret", () => reportsRoute(admin("/api/admin/reports", undefined, "wrong"))],
    ["GET /api/admin/metrics", () => metricsRoute(admin("/api/admin/metrics", undefined, null))],
  ])("%s needs the admin secret", async (_what, call) => {
    expect((await call()).status).toBe(401)
  })

  it("won't moderate without the admin secret, even for a signed-in member", async () => {
    const ada = await member("Ada")
    const bea = await member("Bea")
    signIn(bea)

    const res = await moderateRoute(admin("/api/admin/moderate", { action: "suspend", agentId: ada.id }, null))

    expect(res.status).toBe(401)
    await expect(ownsAgent(ada.id, ada.ownerToken)).resolves.toBe(true)
  })
})

describe("product events", () => {
  it("never gets in the way of what it's counting", async () => {
    const ada = await member("Ada")

    failNext(/INSERT INTO product_events/, "XX000")
    await expect(recordEvent(ada.id, "idea")).resolves.toBeUndefined()

    failNext(/UPDATE members/, "XX000")
    await expect(noteVisit(ada.id)).resolves.toBeUndefined()
  })

  it("holds no text", async () => {
    const { rows } = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'product_events'`)
    expect(rows.map((r) => r.column_name).sort()).toEqual(["agent_id", "created_at", "id", "kind"])
  })

  it("counts a person's visit once a day, from any page", async () => {
    const ada = await member("Ada")
    signIn(ada)

    await requireMember()
    await requireMember()
    vi.setSystemTime(new Date("2026-11-05T10:00:00Z"))
    await requireMember()

    const { rows } = await query(`SELECT count(*)::int AS n FROM product_events WHERE agent_id = $1 AND kind = 'visit'`, [ada.id])
    expect(rows[0].n).toBe(2)
  })
})

describe("the pilot's numbers", () => {
  const event = (agentId: string, kind: string, at: string) =>
    query(`INSERT INTO product_events (id, agent_id, kind, created_at) VALUES ($1, $2, $3, $4)`, [crypto.randomUUID(), agentId, kind, at])

  const ADA = "00000000-0000-4000-8000-00000000000a"
  const BEA = "00000000-0000-4000-8000-00000000000b"
  const CAL = "00000000-0000-4000-8000-00000000000c"

  it("counts who joined, came back and stayed, as people rather than clicks", async () => {
    await event(ADA, "joined", "2026-11-04T10:00:00Z")
    await event(ADA, "visit", "2026-11-04T10:00:00Z")
    await event(ADA, "visit", "2026-11-05T10:00:00Z")
    await event(ADA, "visit", "2026-11-06T10:00:00Z")
    await event(ADA, "visit", "2026-11-12T10:00:00Z")
    await event(BEA, "joined", "2026-11-04T10:00:00Z")
    await event(BEA, "visit", "2026-11-04T18:00:00Z")
    await event(CAL, "joined", "2026-11-04T23:00:00Z")
    await event(CAL, "visit", "2026-11-05T01:00:00Z")

    await expect(getPilotMetrics()).resolves.toMatchObject({ joined: 3, returnedOnLaterDay: 2, activeInWeekTwo: 1 })
  })

  it("doesn't call someone active in week two for coming back later, or for being emailed", async () => {
    await event(ADA, "joined", "2026-11-04T10:00:00Z")
    await event(ADA, "visit", "2026-11-20T10:00:00Z")
    await event(BEA, "joined", "2026-11-04T10:00:00Z")
    await event(BEA, "email_sent", "2026-11-12T10:00:00Z")

    await expect(getPilotMetrics()).resolves.toMatchObject({ activeInWeekTwo: 0 })
  })

  it("counts someone as acting after a briefing only if the action came after it, within a day", async () => {
    await event(ADA, "briefing_seen", "2026-11-04T10:00:00Z")
    await event(ADA, "words", "2026-11-04T11:00:00Z")
    await event(BEA, "words", "2026-11-04T09:00:00Z")
    await event(BEA, "briefing_seen", "2026-11-04T10:00:00Z")
    await event(CAL, "briefing_seen", "2026-11-04T10:00:00Z")
    await event(CAL, "idea", "2026-11-05T10:00:01Z")

    await expect(getPilotMetrics()).resolves.toMatchObject({ actedAfterBriefing: 1 })
  })

  it.each(["idea", "words", "ask_to_meet"])("counts %s as acting", async (kind) => {
    await event(ADA, "briefing_seen", "2026-11-04T10:00:00Z")
    await event(ADA, kind, "2026-11-04T11:00:00Z")

    await expect(getPilotMetrics()).resolves.toMatchObject({ actedAfterBriefing: 1 })
  })

  it("doesn't count following or guiding as the plan's kind of action", async () => {
    await event(ADA, "briefing_seen", "2026-11-04T10:00:00Z")
    await event(ADA, "guide", "2026-11-04T11:00:00Z")

    await expect(getPilotMetrics()).resolves.toMatchObject({ actedAfterBriefing: 0 })
  })

  it("counts introductions, reports and cost", async () => {
    await event(ADA, "intro_connected", "2026-11-04T10:00:00Z")
    await event(BEA, "visit", "2026-11-04T10:00:00Z")
    await event(CAL, "visit", "2026-11-04T10:00:00Z")
    await query(`INSERT INTO spend_days (day, reserved_micros, calls, updated_at) VALUES ('2026-11-04', 3000000, 40, now())`)
    await query(`INSERT INTO spend_days (day, reserved_micros, calls, updated_at) VALUES ('2026-11-05', 1000000, 10, now())`)
    await query(`INSERT INTO reports (id, reporter_id, agent_id, reason, created_at) VALUES ($1, $2, $3, 'misrepresents_me', now())`, [crypto.randomUUID(), ADA, BEA])
    await query(`INSERT INTO reports (id, reporter_id, agent_id, reason, created_at, resolved_at) VALUES ($1, $2, $3, 'other', now(), now())`, [crypto.randomUUID(), ADA, BEA])

    await expect(getPilotMetrics()).resolves.toMatchObject({
      mutualIntroductions: 1,
      reports: 2,
      openReports: 1,
      misrepresentationReports: 1,
      estimatedModelCostUsd: 4,
      activeParticipants: 2,
      estimatedModelCostPerActiveParticipantUsd: 2,
    })
  })

  it("has nothing to divide by before anyone has come", async () => {
    await expect(getPilotMetrics()).resolves.toMatchObject({ joined: 0, estimatedModelCostPerActiveParticipantUsd: null })
  })

  it("still counts someone who deleted their account, with nothing identifying them", async () => {
    const ada = await member("Ada")
    await recordEvent(ada.id, "joined")

    await deleteAccount(ada.id)

    await expect(getPilotMetrics()).resolves.toMatchObject({ joined: 1 })
    const { rows } = await query(`SELECT * FROM product_events`)
    expect(JSON.stringify(rows)).not.toContain("Ada")
    expect(JSON.stringify(rows)).not.toContain(ada.email)
  })

  it("is served only as counts", async () => {
    const res = await metricsRoute(admin("/api/admin/metrics"))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ joined: 0 })
  })
})
