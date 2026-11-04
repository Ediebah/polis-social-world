import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { memberFromCookies } from "@/lib/members"
import { query } from "./helpers/fake-db"
import { spawnAgent } from "./helpers/citizens"

const cookieJar = new Map<string, string>()

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
  }),
}))

const spawn = (name = "Ada") =>
  spawnAgent({
    handle: name.toLowerCase(),
    name,
    traits: ["curious", "bold", "loyal"],
    backstory: "",
    goal: "Find a good question.",
    location: "studio",
  })

const cookie = (name: string, value: string) => [{ name, value }]

beforeEach(() => cookieJar.clear())

describe("who counts as a member", () => {
  it("is anyone holding a citizen's owner token", async () => {
    const { id, ownerToken } = await spawn()

    await expect(memberFromCookies(cookie(`polis-own-${id}`, ownerToken))).resolves.toMatchObject({ id, name: "Ada" })
  })

  it.each([
    ["no cookies", () => []],
    ["unrelated cookies", () => cookie("theme", "dark")],
    ["a malformed token", (id: string) => cookie(`polis-own-${id}`, "not-a-uuid")],
    ["a wrong token", (id: string) => cookie(`polis-own-${id}`, crypto.randomUUID())],
    ["a malformed citizen id", (_id: string, token: string) => cookie("polis-own-not-a-uuid", token)],
    ["someone else's token", (_id: string, token: string) => cookie(`polis-own-${crypto.randomUUID()}`, token)],
  ])("isn't someone with %s", async (_label, make) => {
    const { id, ownerToken } = await spawn()

    await expect(memberFromCookies(make(id, ownerToken))).resolves.toBeNull()
  })

  it("isn't the owner of a citizen that's no longer active", async () => {
    const { id, ownerToken } = await spawn()
    await query(`UPDATE agents SET status = 'suspended' WHERE id = $1`, [id])

    await expect(memberFromCookies(cookie(`polis-own-${id}`, ownerToken))).resolves.toBeNull()
  })

  it("isn't anyone claiming a house agent, which has no token", async () => {
    const id = crypto.randomUUID()
    await query(`INSERT INTO agents (id, name, status, is_house, created_at) VALUES ($1, 'Mira', 'alive', TRUE, now())`, [id])

    await expect(memberFromCookies(cookie(`polis-own-${id}`, crypto.randomUUID()))).resolves.toBeNull()
  })
})

// Default-deny: walks the app directory, so a route added later is covered automatically.
function filesNamed(name: string, dir = join(process.cwd(), "app")): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return filesNamed(name, path)
    return entry === name ? [path] : []
  })
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
const PUBLIC_PAGES = ["/join/page.tsx", "/join/[code]/page.tsx"]

describe("everything is members-only unless it's on purpose", () => {
  const routes = filesNamed("route.ts")
  const pages = filesNamed("page.tsx").filter((p) => !PUBLIC_PAGES.some((allowed) => p.endsWith(allowed)))

  it("finds the routes and pages to check", () => {
    expect(routes.length).toBeGreaterThanOrEqual(9)
    expect(pages.length).toBeGreaterThanOrEqual(3)
  })

  it.each(routes.map((r) => [r.slice(r.indexOf("/app/"))]))("%s turns away a visitor", async (path) => {
    const mod = await import(/* @vite-ignore */ join(process.cwd(), path))
    const methods = METHODS.filter((m) => mod[m])
    expect(methods.length).toBeGreaterThan(0)

    for (const method of methods) {
      const id = crypto.randomUUID()
      const req = new NextRequest(`http://polis.test/api/x?q=a`, {
        method,
        body: method === "GET" ? undefined : JSON.stringify({ question: "hi", text: "hi", paused: true, count: 1 }),
      })
      const res = await mod[method](req, { params: Promise.resolve({ id }) })
      expect(res.status, `${method} ${path}`).toBe(401)
    }
  })

  it.each(pages.map((p) => [p.slice(p.indexOf("/app/"))]))("%s sends a visitor to the invite page", async (path) => {
    const mod = await import(/* @vite-ignore */ join(process.cwd(), path))

    const rendered = mod.default({ params: Promise.resolve({ id: crypto.randomUUID() }) })

    await expect(rendered).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/join;/) })
  })
})
