import { createHash, randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { NextResponse, type NextRequest } from "next/server"
import { insertIdea, followConversation } from "./conversations"
import { query, transaction } from "./db"
import { retryOnConflict } from "./occ"
import { ownerPairs } from "./owner-cookies"
import { createCitizen, getOwnedAgents } from "./queries"
import type { Place } from "./places"

// Joined citizens all start here; what sets them apart is their interests and ideas.
const JOINED_GOAL = "Find people who care about the same things, and learn from them."

export type Member = { id: string; name: string }

// There are no logins: holding a citizen's owner token is what makes someone a member.
export async function memberFromCookies(all: { name: string; value: string }[]): Promise<Member | null> {
  const owned = await getOwnedAgents(ownerPairs(all))
  return owned[0] ?? null
}

export async function currentMember(): Promise<Member | null> {
  return memberFromCookies((await cookies()).getAll())
}

// For pages. Every page calls this itself, because a proxy can't reach the database
// reliably and the framework advises against relying on one for authorization.
export async function requireMember(): Promise<Member> {
  const member = await currentMember()
  if (!member) redirect("/join")
  return member
}

// For routes. tests/members.test.ts walks every route file, so one that forgets this
// fails the suite.
export function memberRoute<Context>(handler: (req: NextRequest, context: Context) => Promise<Response>) {
  return async (req: NextRequest, context: Context): Promise<Response> => {
    if (!(await memberFromCookies(req.cookies.getAll()))) {
      return NextResponse.json({ error: "members_only" }, { status: 401 })
    }
    return handler(req, context)
  }
}

// Only a hash is stored, so reading the table doesn't reveal any invite that still works.
function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex")
}

export async function createInvites(count: number, note: string | null = null): Promise<string[]> {
  const codes = Array.from({ length: count }, () => randomBytes(24).toString("base64url"))
  const now = new Date().toISOString()
  await transaction(async (client) => {
    for (const code of codes) {
      await client.query(`INSERT INTO invites (code_hash, note, created_at) VALUES ($1, $2, $3)`, [hashCode(code), note, now])
    }
  })
  return codes
}

export async function inviteStatus(code: string): Promise<"open" | "used" | "unknown"> {
  const { rows } = await query<{ used_at: string | null }>(`SELECT used_at FROM invites WHERE code_hash = $1`, [
    hashCode(code),
  ])
  if (rows.length === 0) return "unknown"
  return rows[0].used_at ? "used" : "open"
}

export async function inviteCounts(): Promise<{ total: number; used: number }> {
  const { rows } = await query<{ total: number; used: number }>(
    `SELECT count(*)::int AS total, count(used_at)::int AS used FROM invites`,
  )
  return { total: Number(rows[0].total), used: Number(rows[0].used) }
}

export type JoinRefusal = "invite" | "email_taken"

export class JoinError extends Error {
  constructor(readonly reason: JoinRefusal) {
    super(`join refused: ${reason}`)
    this.name = "JoinError"
  }
}

export interface JoinInput {
  code: string
  email: string
  name: string
  traits: string[]
  interests: string
  idea: string
  place: Place
}

export interface JoinResult {
  id: string
  ownerToken: string
  conversationId: string
}

// One atomic transaction: if anything fails, the invite stays unused and nothing is left
// behind. The first idea opens its conversation right away, so a house agent can answer.
export function joinWithInvite(input: JoinInput): Promise<JoinResult> {
  const email = input.email.trim().toLowerCase()
  return retryOnConflict(() =>
    transaction(async (client) => {
      const now = new Date().toISOString()
      const invite = await client.query(
        `UPDATE invites SET used_at = $1 WHERE code_hash = $2 AND used_at IS NULL`,
        [now, hashCode(input.code)],
      )
      if (invite.rowCount !== 1) throw new JoinError("invite")

      const { id, ownerToken } = await createCitizen(client, {
        handle: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 30) || "citizen",
        name: input.name,
        traits: input.traits,
        backstory: "",
        goal: JOINED_GOAL,
        interests: input.interests,
        location: input.place,
      })

      // Kept apart from agents so that no query about citizens can return one by accident.
      const member = await client.query(
        `INSERT INTO members (email, agent_id, created_at) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING`,
        [email, id, now],
      )
      if (member.rowCount !== 1) throw new JoinError("email_taken")
      await client.query(`UPDATE invites SET agent_id = $1 WHERE code_hash = $2`, [id, hashCode(input.code)])

      const conversationId = crypto.randomUUID()
      const ideaId = await insertIdea(client, {
        agentId: id,
        text: input.idea,
        place: input.place,
        now,
        conversationId,
      })
      await client.query(
        `INSERT INTO conversations (id, idea_id, place, opened_by, status, agent_turns, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'open', 0, $5, $5)`,
        [conversationId, ideaId, input.place, id, now],
      )
      await followConversation(client, id, conversationId, now)
      return { id, ownerToken, conversationId }
    }),
  )
}
