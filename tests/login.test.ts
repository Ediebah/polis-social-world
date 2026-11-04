import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { redeemLoginLinkAction, requestLoginLinkAction, signOutAction } from "@/app/actions"
import LoginPage from "@/app/login/page"
import { LOGIN_LINK_MINUTES, MAX_LINKS_PER_HOUR, peekLoginLink, redeemLoginLink, sendLoginLink } from "@/lib/login"
import { createInvites, joinWithInvite } from "@/lib/members"
import { failNextEmail, sentEmails } from "./helpers/fake-email"
import { failNext, query } from "./helpers/fake-db"

const cookieJar = new Map<string, string>()
const cookieOptions = new Map<string, Record<string, unknown>>()
const afterCalls: (() => unknown)[] = []

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieJar.set(name, value)
      cookieOptions.set(name, options)
    },
    delete: (name: string) => cookieJar.delete(name),
  }),
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => afterCalls.push(fn),
}))

const EMAIL = "ada@example.com"

async function member(email = EMAIL, name = "Ada") {
  const { created } = await createInvites([email])
  return joinWithInvite({
    code: created[0].code,
    name,
    traits: ["curious", "bold", "loyal"],
    interests: "repair",
    idea: "Libraries should lend tools, not just books.",
    place: "studio",
  })
}

function tokenFromEmail(index = sentEmails.length - 1): string {
  const match = sentEmails[index].text.match(/https:\/\/city\.test\/login\/([\w-]+)/)
  if (!match) throw new Error("no link in the email")
  return match[1]
}

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
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

const count = async (table: string) => (await query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number

beforeEach(() => {
  cookieJar.clear()
  afterCalls.length = 0
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-04T10:00:00Z"))
  vi.stubEnv("EMAIL_FROM", "hello@city.test")
  vi.stubEnv("AWS_EMAIL_ROLE_ARN", "arn:aws:iam::123456789012:role/email")
  vi.stubEnv("APP_URL", "https://city.test")
})

describe("sending a link", () => {
  it("emails a member a link from the app's own address, and stores only its hash", async () => {
    await member()

    await sendLoginLink(EMAIL)

    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0]).toMatchObject({ from: "Mindworld <hello@city.test>", to: EMAIL })
    expect(sentEmails[0].subject).toBe("Your sign-in link for Mindworld")
    const token = tokenFromEmail()
    expect(token.length).toBeGreaterThanOrEqual(40)
    const { rows } = await query(`SELECT token_hash FROM login_links`)
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).not.toBe(token)
  })

  it("doesn't put the owner token in the email", async () => {
    const { ownerToken } = await member()

    await sendLoginLink(EMAIL)

    expect(sentEmails[0].text).not.toContain(ownerToken)
  })

  it("finds the member whatever the capitals and spaces", async () => {
    await member()

    await sendLoginLink("  ADA@Example.com ")

    expect(sentEmails.map((m) => m.to)).toEqual([EMAIL])
  })

  it("sends nothing to an address that isn't a member", async () => {
    await member()

    await sendLoginLink("stranger@example.com")

    expect(sentEmails).toEqual([])
    expect(await count("login_links")).toBe(0)
  })

  it("sends nothing for a citizen that's no longer active", async () => {
    const { id } = await member()
    await query(`UPDATE agents SET status = 'suspended' WHERE id = $1`, [id])

    await sendLoginLink(EMAIL)

    expect(sentEmails).toEqual([])
  })

  it("stops at the hourly limit, for that member only, and starts again the next hour", async () => {
    await member()
    await member("bea@example.com", "Bea")

    for (let i = 0; i < MAX_LINKS_PER_HOUR + 2; i++) await sendLoginLink(EMAIL)
    expect(sentEmails).toHaveLength(MAX_LINKS_PER_HOUR)

    await sendLoginLink("bea@example.com")
    expect(sentEmails).toHaveLength(MAX_LINKS_PER_HOUR + 1)

    vi.setSystemTime(new Date("2026-11-04T11:00:00Z"))
    sentEmails.length = 0
    for (let i = 0; i < MAX_LINKS_PER_HOUR + 2; i++) await sendLoginLink(EMAIL)
    expect(sentEmails).toHaveLength(MAX_LINKS_PER_HOUR)
  })

  it("retries a conflict at commit, where the database raises it, without counting twice", async () => {
    await member()
    failNext(/^COMMIT$/)

    await sendLoginLink(EMAIL)

    expect(sentEmails).toHaveLength(1)
    const { rows } = await query(`SELECT links_this_hour FROM members`)
    expect(rows[0].links_this_hour).toBe(1)
    expect(await count("login_links")).toBe(1)
  })

  it("sends replies and bounces to a mailbox someone reads, when there is one", async () => {
    await member()
    await sendLoginLink(EMAIL)
    expect(sentEmails[0]).toMatchObject({ replyTo: undefined, feedbackTo: undefined })

    vi.stubEnv("EMAIL_REPLY_TO", "founder@example.com")
    await sendLoginLink(EMAIL)

    expect(sentEmails[1]).toMatchObject({ from: "Mindworld <hello@city.test>", replyTo: ["founder@example.com"], feedbackTo: "founder@example.com" })
  })

  it.each(["EMAIL_FROM", "AWS_EMAIL_ROLE_ARN", "APP_URL"])("sends nothing, and leaves no link behind, without %s", async (name) => {
    await member()
    vi.stubEnv(name, "")

    await sendLoginLink(EMAIL)

    expect(sentEmails).toEqual([])
    expect(await count("login_links")).toBe(0)
  })
})

describe("using a link", () => {
  async function linkFor(email = EMAIL) {
    await sendLoginLink(email)
    return tokenFromEmail()
  }

  it("can be read as often as needed, because mail scanners open links", async () => {
    await member()
    const token = await linkFor()

    await expect(peekLoginLink(token)).resolves.toEqual({ name: "Ada" })
    await expect(peekLoginLink(token)).resolves.toEqual({ name: "Ada" })

    await expect(redeemLoginLink(token)).resolves.toMatchObject({ name: "Ada" })
  })

  it("works once", async () => {
    const { id, ownerToken } = await member()
    const token = await linkFor()

    await expect(redeemLoginLink(token)).resolves.toEqual({ id, ownerToken, name: "Ada" })
    await expect(redeemLoginLink(token)).resolves.toBeNull()
    await expect(peekLoginLink(token)).resolves.toBeNull()
  })

  it("works until it expires, and not after", async () => {
    await member()
    const early = await linkFor()
    const late = await linkFor()

    vi.setSystemTime(Date.parse("2026-11-04T10:00:00Z") + LOGIN_LINK_MINUTES * 60_000 - 1000)
    await expect(redeemLoginLink(early)).resolves.not.toBeNull()

    vi.setSystemTime(Date.parse("2026-11-04T10:00:00Z") + LOGIN_LINK_MINUTES * 60_000 + 1000)
    await expect(peekLoginLink(late)).resolves.toBeNull()
    await expect(redeemLoginLink(late)).resolves.toBeNull()
  })

  it.each(["", "made-up", "x".repeat(5000)])("refuses a token of %j", async (token) => {
    await member()
    await linkFor()

    await expect(peekLoginLink(token)).resolves.toBeNull()
    await expect(redeemLoginLink(token)).resolves.toBeNull()
  })

  it("refuses a citizen suspended after the link was sent", async () => {
    const { id } = await member()
    const token = await linkFor()
    await query(`UPDATE agents SET status = 'suspended' WHERE id = $1`, [id])

    await expect(peekLoginLink(token)).resolves.toBeNull()
    await expect(redeemLoginLink(token)).resolves.toBeNull()
  })
})

describe("the sign-in form", () => {
  it("gives the same answer for a member and a stranger, and works after responding", async () => {
    await member()

    const known = await requestLoginLinkAction({}, form({ email: EMAIL }))
    const unknown = await requestLoginLinkAction({}, form({ email: "stranger@example.com" }))

    expect(known).toEqual({ sent: true })
    expect(unknown).toEqual(known)
    expect(sentEmails).toEqual([])

    await Promise.all(afterCalls.map((fn) => fn()))
    expect(sentEmails.map((m) => m.to)).toEqual([EMAIL])
  })

  it("gives the same answer over the hourly limit", async () => {
    await member()
    for (let i = 0; i < MAX_LINKS_PER_HOUR; i++) await sendLoginLink(EMAIL)

    await expect(requestLoginLinkAction({}, form({ email: EMAIL }))).resolves.toEqual({ sent: true })
  })

  it("doesn't let a failed email reach the person or the logs unhandled", async () => {
    await member()
    failNextEmail()

    await requestLoginLinkAction({}, form({ email: EMAIL }))

    await expect(Promise.all(afterCalls.map((fn) => fn()))).resolves.toBeTruthy()
    expect(sentEmails).toEqual([])
  })

  it.each(["", "not-an-email", `${"x".repeat(250)}@example.com`])("refuses %j and does no work", async (email) => {
    const state = await requestLoginLinkAction({}, form({ email }))

    expect(state.error).toMatch(/email/i)
    expect(afterCalls).toHaveLength(0)
  })
})

describe("confirming on the page the link opens", () => {
  it("signs this browser in and goes home", async () => {
    const { id, ownerToken } = await member()
    await sendLoginLink(EMAIL)

    const to = await redirectOf(redeemLoginLinkAction(form({ token: tokenFromEmail() })))

    expect(to).toBe("/")
    expect(cookieJar.get(`polis-own-${id}`)).toBe(ownerToken)
    expect(cookieOptions.get(`polis-own-${id}`)).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" })
  })

  it("replaces any other citizen this browser held, so nobody acts as the wrong one", async () => {
    const other = await member("bea@example.com", "Bea")
    cookieJar.set(`polis-own-${other.id}`, other.ownerToken)
    cookieJar.set("theme", "dark")
    const { id } = await member()
    await sendLoginLink(EMAIL)

    await redirectOf(redeemLoginLinkAction(form({ token: tokenFromEmail() })))

    expect(cookieJar.has(`polis-own-${other.id}`)).toBe(false)
    expect(cookieJar.has(`polis-own-${id}`)).toBe(true)
    expect(cookieJar.get("theme")).toBe("dark")
  })

  it("sends a used link back to ask for a new one, without touching cookies", async () => {
    await member()
    await sendLoginLink(EMAIL)
    const token = tokenFromEmail()
    await redeemLoginLink(token)

    const to = await redirectOf(redeemLoginLinkAction(form({ token })))

    expect(to).toBe("/login?expired=1")
    expect(cookieJar.size).toBe(0)
  })
})

describe("signing out", () => {
  it("removes only this browser's citizen, and goes to the sign-in page", async () => {
    const { id, ownerToken } = await member()
    cookieJar.set(`polis-own-${id}`, ownerToken)
    cookieJar.set("theme", "dark")

    const to = await redirectOf(signOutAction())

    expect(to).toBe("/login")
    expect(cookieJar.has(`polis-own-${id}`)).toBe(false)
    expect(cookieJar.get("theme")).toBe("dark")
  })
})

describe("the sign-in page", () => {
  const render = async () => renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }))

  it("offers the form when email is set up", async () => {
    expect(await render()).toContain('name="email"')
  })

  it.each(["EMAIL_FROM", "AWS_EMAIL_ROLE_ARN", "APP_URL"])("says email is off, rather than promising a link, without %s", async (name) => {
    vi.stubEnv(name, "")

    const html = await render()

    expect(html).not.toContain('name="email"')
    expect(html).toMatch(/switched on/)
  })
})
