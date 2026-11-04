import type { ClientBase } from "pg"
import { query, transaction } from "./db"
import { retryOnConflict } from "./occ"
import { isPlace } from "./places"
import { bumpCounter, UUID_RE } from "./queries"
import type { ContributionView, ConversationView } from "./types"

export const MAX_OWNER_TEXT = 1000
export const MAX_OWNER_WORDS_PER_CONVERSATION = 5
// Agents take ideas oldest first, so without this one person could bury everyone else's.
export const MAX_IDEAS_PER_DAY = 3
const MIN_IDEA_TEXT = 10
const OWNER_POST_COOLDOWN_MS = 30_000

export type OwnerWordsRefusal = "too_short" | "too_long" | "closed" | "limit" | "idea_limit" | "slow_down" | "bad_place"

export class OwnerWordsError extends Error {
  constructor(readonly reason: OwnerWordsRefusal) {
    super(`owner words refused: ${reason}`)
    this.name = "OwnerWordsError"
  }
}

// People's words are quoted as written, so this only removes the space around them.
function checkedText(raw: string, min: number): string {
  const text = raw.trim()
  if (text.length < min) throw new OwnerWordsError("too_short")
  if (text.length > MAX_OWNER_TEXT) throw new OwnerWordsError("too_long")
  return text
}

async function claimOwnerPost(client: ClientBase, agentId: string, now: Date) {
  const cutoff = new Date(now.getTime() - OWNER_POST_COOLDOWN_MS).toISOString()
  const r = await client.query(
    `UPDATE agents SET last_words_at = $1
      WHERE id = $2 AND (last_words_at IS NULL OR last_words_at < $3)`,
    [now.toISOString(), agentId, cutoff],
  )
  if (r.rowCount !== 1) throw new OwnerWordsError("slow_down")
}

export async function shareIdea(agentId: string, rawText: string, place: string): Promise<{ id: string }> {
  const text = checkedText(rawText, MIN_IDEA_TEXT)
  if (!isPlace(place)) throw new OwnerWordsError("bad_place")

  return retryOnConflict(() =>
    transaction(async (client) => {
      const now = new Date()
      const shared = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ideas WHERE agent_id = $1 AND created_at > $2`,
        [agentId, new Date(now.getTime() - 24 * 60 * 60_000).toISOString()],
      )
      if (Number(shared.rows[0].n) >= MAX_IDEAS_PER_DAY) throw new OwnerWordsError("idea_limit")

      await claimOwnerPost(client, agentId, now)

      const id = crypto.randomUUID()
      await client.query(`INSERT INTO ideas (id, agent_id, place, text, created_at) VALUES ($1, $2, $3, $4, $5)`, [
        id,
        agentId,
        place,
        text,
        now.toISOString(),
      ])
      await client.query(
        `INSERT INTO world_events (id, agent_id, kind, payload, location, ref_id, created_at)
         VALUES ($1, $2, 'idea', $3::jsonb, $4, $5, $6)`,
        [crypto.randomUUID(), agentId, JSON.stringify({ text, idea_id: id }), place, id, now.toISOString()],
      )
      await bumpCounter(client, "total_actions", 1)
      return { id }
    }),
  )
}

export async function addOwnerWords(agentId: string, conversationId: string, rawText: string): Promise<{ id: string }> {
  const text = checkedText(rawText, 1)
  if (!UUID_RE.test(conversationId)) throw new OwnerWordsError("closed")

  return retryOnConflict(() =>
    transaction(async (client) => {
      const now = new Date()
      const conversation = await client.query<{ place: string }>(
        `SELECT place FROM conversations WHERE id = $1 AND status = 'open'`,
        [conversationId],
      )
      if (conversation.rows.length === 0) throw new OwnerWordsError("closed")

      const posted = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM contributions
          WHERE conversation_id = $1 AND agent_id = $2 AND author_kind = 'owner'`,
        [conversationId, agentId],
      )
      if (Number(posted.rows[0].n) >= MAX_OWNER_WORDS_PER_CONVERSATION) throw new OwnerWordsError("limit")

      await claimOwnerPost(client, agentId, now)

      const id = crypto.randomUUID()
      await client.query(
        `INSERT INTO contributions (id, conversation_id, agent_id, author_kind, text, created_at)
         VALUES ($1, $2, $3, 'owner', $4, $5)`,
        [id, conversationId, agentId, text, now.toISOString()],
      )
      await client.query(`UPDATE conversations SET updated_at = $1 WHERE id = $2`, [now.toISOString(), conversationId])
      await followConversation(client, agentId, conversationId, now.toISOString())
      await client.query(
        `INSERT INTO world_events (id, agent_id, kind, payload, location, ref_id, created_at)
         VALUES ($1, $2, 'words', $3::jsonb, $4, $5, $6)`,
        [
          crypto.randomUUID(),
          agentId,
          JSON.stringify({ text, conversation_id: conversationId }),
          conversation.rows[0].place,
          id,
          now.toISOString(),
        ],
      )
      await bumpCounter(client, "total_actions", 1)
      return { id }
    }),
  )
}

export async function followConversation(client: ClientBase, agentId: string, conversationId: string, now: string) {
  await client.query(
    `INSERT INTO follows (agent_id, conversation_id, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (agent_id, conversation_id) DO NOTHING`,
    [agentId, conversationId, now],
  )
}

export async function getConversation(id: string): Promise<ConversationView | null> {
  if (!UUID_RE.test(id)) return null
  const { rows } = await query<Omit<ConversationView, "idea" | "contributions"> & { idea_id: string | null }>(
    `SELECT c.id, c.idea_id, c.place, c.question, c.status, c.created_at, c.opened_by, a.name AS opened_by_name
       FROM conversations c LEFT JOIN agents a ON a.id = c.opened_by
      WHERE c.id = $1`,
    [id],
  )
  if (rows.length === 0) return null
  const { idea_id, ...conversation } = rows[0]

  const [idea, contributions] = await Promise.all([
    idea_id
      ? query<NonNullable<ConversationView["idea"]>>(
          `SELECT i.id, i.text, i.agent_id, a.name AS agent_name
             FROM ideas i JOIN agents a ON a.id = i.agent_id
            WHERE i.id = $1`,
          [idea_id],
        )
      : null,
    query<ContributionView>(
      `SELECT con.id, con.agent_id, a.name AS agent_name, a.is_house, con.author_kind, con.move, con.text,
              con.created_at, m.conversation_id AS remembered_from, m.text AS remembered_text
         FROM contributions con
         JOIN agents a ON a.id = con.agent_id
         LEFT JOIN memories m ON m.id = con.memory_id
        WHERE con.conversation_id = $1
        ORDER BY con.created_at ASC, con.id ASC`,
      [id],
    ),
  ])

  return { ...conversation, idea: idea?.rows[0] ?? null, contributions: contributions.rows }
}
