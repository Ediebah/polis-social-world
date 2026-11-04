import { query, transaction } from "./db"
import { claimOwnerPost } from "./conversations"
import { retryOnConflict } from "./occ"
import { UUID_RE } from "./queries"

export const MIN_CONTACT = 3
export const MAX_CONTACT = 200
// The city is small, so this mostly stops one person from asking everyone at once.
export const MAX_ASKS_PER_DAY = 3

export type IntroRefusal = "self" | "no_one" | "contact" | "limit" | "slow_down" | "already" | "gone"

export class IntroError extends Error {
  constructor(readonly reason: IntroRefusal) {
    super(`introduction refused: ${reason}`)
    this.name = "IntroError"
  }
}

// One row per pair, whichever of them asked first. Ids come from forms and are compared
// as text here, so an uppercase copy of one mustn't count as a different person.
function pairKey(a: string, b: string): string {
  return [a.toLowerCase(), b.toLowerCase()].sort().join(":")
}

function checkedContact(raw: string | undefined): string {
  const contact = (raw ?? "").trim()
  if (contact.length < MIN_CONTACT || contact.length > MAX_CONTACT) throw new IntroError("contact")
  return contact
}

// Asking counts as accepting on your side, so if the other person has already asked, or
// asked and you once said no, this is what connects you.
export function askToMeet(actorId: string, targetId: string, rawContact: string, conversationId?: string): Promise<"asked" | "connected"> {
  if (actorId.toLowerCase() === targetId.toLowerCase()) return Promise.reject(new IntroError("self"))
  if (!UUID_RE.test(targetId)) return Promise.reject(new IntroError("no_one"))

  return retryOnConflict(() =>
    transaction(async (client) => {
      const contact = checkedContact(rawContact)
      const target = await client.query(
        `SELECT 1 FROM agents WHERE id = $1 AND status = 'alive' AND is_house IS NOT TRUE AND owner_token IS NOT NULL`,
        [targetId],
      )
      if (target.rows.length === 0) throw new IntroError("no_one")

      const now = new Date()
      const key = pairKey(actorId, targetId)
      const existing = await client.query<{ requester_id: string; status: string }>(
        `SELECT requester_id::text AS requester_id, status FROM introductions WHERE pair_key = $1`,
        [key],
      )
      if (existing.rows.length > 0) {
        const { requester_id, status } = existing.rows[0]
        if (status === "accepted" || requester_id === actorId) throw new IntroError("already")
        await client.query(
          `UPDATE introductions SET status = 'accepted', recipient_contact = $1, responded_at = $2 WHERE pair_key = $3`,
          [contact, now.toISOString(), key],
        )
        return "connected"
      }

      const asked = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM introductions WHERE requester_id = $1 AND created_at > $2`,
        [actorId, new Date(now.getTime() - 24 * 60 * 60_000).toISOString()],
      )
      if (Number(asked.rows[0].n) >= MAX_ASKS_PER_DAY) throw new IntroError("limit")

      if (!(await claimOwnerPost(client, actorId, now))) throw new IntroError("slow_down")

      let source: string | null = null
      if (conversationId && UUID_RE.test(conversationId)) {
        const found = await client.query(`SELECT 1 FROM conversations WHERE id = $1`, [conversationId])
        if (found.rows.length > 0) source = conversationId
      }
      await client.query(
        `INSERT INTO introductions (pair_key, requester_id, recipient_id, conversation_id, requester_contact, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
        [key, actorId, targetId, source, contact, now.toISOString()],
      )
      return "asked"
    }),
  )
}

// Only the person who was asked can answer, and only while the question is open.
export function respondToIntroduction(actorId: string, otherId: string, accept: boolean, rawContact?: string): Promise<void> {
  return retryOnConflict(async () => {
    const contact = accept ? checkedContact(rawContact) : null
    const { rowCount } = await query(
      `UPDATE introductions SET status = $1, recipient_contact = $2, responded_at = $3
        WHERE pair_key = $4 AND recipient_id = $5 AND status = 'pending'`,
      [accept ? "accepted" : "declined", contact, new Date().toISOString(), pairKey(actorId, otherId), actorId],
    )
    if (rowCount !== 1) throw new IntroError("gone")
  })
}

export interface IntroPerson {
  agentId: string
  name: string
  conversationId: string | null
  createdAt: string
}

export interface Introductions {
  incoming: IntroPerson[]
  // A request stays here whatever the answer: someone who was turned down isn't told.
  outgoing: (IntroPerson & { yourContact: string })[]
  connected: (IntroPerson & { theirContact: string; yourContact: string })[]
}

// The one place contact details leave the database: the other person's only once both
// have accepted, and your own always.
export async function getIntroductions(agentId: string): Promise<Introductions> {
  const { rows } = await query<{
    requester_id: string
    recipient_id: string
    requester_name: string
    recipient_name: string
    conversation_id: string | null
    status: string
    created_at: string
    requester_contact: string | null
    recipient_contact: string | null
  }>(
    `SELECT i.requester_id::text AS requester_id, i.recipient_id::text AS recipient_id,
            req.name AS requester_name, rec.name AS recipient_name,
            i.conversation_id::text AS conversation_id, i.status, i.created_at,
            i.requester_contact, i.recipient_contact
       FROM introductions i
       JOIN agents req ON req.id = i.requester_id AND req.status = 'alive'
       JOIN agents rec ON rec.id = i.recipient_id AND rec.status = 'alive'
      WHERE i.requester_id = $1 OR i.recipient_id = $1
      ORDER BY i.created_at DESC`,
    [agentId],
  )

  const result: Introductions = { incoming: [], outgoing: [], connected: [] }
  for (const row of rows) {
    const asked = row.requester_id === agentId
    const person: IntroPerson = {
      agentId: asked ? row.recipient_id : row.requester_id,
      name: asked ? row.recipient_name : row.requester_name,
      conversationId: row.conversation_id,
      createdAt: row.created_at,
    }
    if (row.status === "accepted") {
      result.connected.push({
        ...person,
        theirContact: (asked ? row.recipient_contact : row.requester_contact) ?? "",
        yourContact: (asked ? row.requester_contact : row.recipient_contact) ?? "",
      })
    } else if (asked) {
      result.outgoing.push({ ...person, yourContact: row.requester_contact ?? "" })
    } else if (row.status === "pending") {
      result.incoming.push(person)
    }
  }
  return result
}

export async function countWaitingForYou(agentId: string): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM introductions i JOIN agents req ON req.id = i.requester_id AND req.status = 'alive'
      WHERE i.recipient_id = $1 AND i.status = 'pending'`,
    [agentId],
  )
  return Number(rows[0].n)
}

export type IntroductionState = "none" | "asked" | "incoming" | "connected"

export async function introductionWith(agentId: string, otherId: string): Promise<IntroductionState> {
  const { rows } = await query<{ requester_id: string; status: string }>(
    `SELECT requester_id::text AS requester_id, status FROM introductions WHERE pair_key = $1`,
    [pairKey(agentId, otherId)],
  )
  if (rows.length === 0) return "none"
  if (rows[0].status === "accepted") return "connected"
  if (rows[0].requester_id === agentId) return "asked"
  return rows[0].status === "pending" ? "incoming" : "none"
}
