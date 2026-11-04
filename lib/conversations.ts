import type { ClientBase } from "pg"
import { query, transaction } from "./db"
import { retryOnConflict } from "./occ"
import { isPlace, toPlace, type Place } from "./places"
import { bumpCounter, OWNER_POST_COOLDOWN_MS, UUID_RE } from "./queries"
import type { ContributionView, ConversationView } from "./types"

export const MAX_OWNER_TEXT = 1000
export const MAX_OWNER_WORDS_PER_CONVERSATION = 5
// Agents take ideas oldest first, so without this one person could bury everyone else's.
export const MAX_IDEAS_PER_DAY = 3
export const MIN_IDEA_TEXT = 10

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

// The wait between anything a person does that reaches someone else. False means wait.
export async function claimOwnerPost(client: ClientBase, agentId: string, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - OWNER_POST_COOLDOWN_MS).toISOString()
  const r = await client.query(
    `UPDATE agents SET last_words_at = $1
      WHERE id = $2 AND (last_words_at IS NULL OR last_words_at < $3)`,
    [now.toISOString(), agentId, cutoff],
  )
  return r.rowCount === 1
}

// conversationId is set when the idea opens a conversation straight away, so the feed
// can link to it.
export async function insertIdea(
  client: ClientBase,
  idea: { agentId: string; text: string; place: string; now: string; conversationId?: string },
): Promise<string> {
  const id = crypto.randomUUID()
  await client.query(`INSERT INTO ideas (id, agent_id, place, text, created_at) VALUES ($1, $2, $3, $4, $5)`, [
    id,
    idea.agentId,
    idea.place,
    idea.text,
    idea.now,
  ])
  await client.query(
    `INSERT INTO world_events (id, agent_id, kind, payload, location, ref_id, created_at)
     VALUES ($1, $2, 'idea', $3::jsonb, $4, $5, $6)`,
    [
      crypto.randomUUID(),
      idea.agentId,
      JSON.stringify({ text: idea.text, idea_id: id, conversation_id: idea.conversationId }),
      idea.place,
      id,
      idea.now,
    ],
  )
  await bumpCounter(client, "total_actions", 1)
  return id
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

      if (!(await claimOwnerPost(client, agentId, now))) throw new OwnerWordsError("slow_down")

      const id = await insertIdea(client, { agentId, text, place, now: now.toISOString() })
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

      if (!(await claimOwnerPost(client, agentId, now))) throw new OwnerWordsError("slow_down")

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

export async function followPlace(client: ClientBase, agentId: string, place: string, now: string) {
  await client.query(
    `INSERT INTO place_follows (agent_id, place, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (agent_id, place) DO NOTHING`,
    [agentId, place, now],
  )
}

export async function setConversationFollow(agentId: string, conversationId: string, follow: boolean): Promise<void> {
  if (!UUID_RE.test(conversationId)) return
  const now = new Date().toISOString()
  await retryOnConflict(() =>
    transaction(async (client) => {
      if (!follow) {
        await client.query(`DELETE FROM follows WHERE agent_id = $1 AND conversation_id = $2`, [agentId, conversationId])
        return
      }
      const found = await client.query(`SELECT 1 FROM conversations WHERE id = $1`, [conversationId])
      if (found.rows.length > 0) await followConversation(client, agentId, conversationId, now)
    }),
  )
}

export async function setPlaceFollow(agentId: string, place: Place, follow: boolean): Promise<void> {
  const now = new Date().toISOString()
  await retryOnConflict(() =>
    transaction(async (client) => {
      if (follow) await followPlace(client, agentId, place, now)
      else await client.query(`DELETE FROM place_follows WHERE agent_id = $1 AND place = $2`, [agentId, place])
    }),
  )
}

export async function isFollowing(agentId: string, conversationId: string): Promise<boolean> {
  const { rows } = await query(`SELECT 1 FROM follows WHERE agent_id = $1 AND conversation_id = $2`, [agentId, conversationId])
  return rows.length > 0
}

export async function getFollowedPlaces(agentId: string): Promise<Place[]> {
  const { rows } = await query<{ place: string }>(`SELECT place FROM place_follows WHERE agent_id = $1 ORDER BY place`, [agentId])
  return rows.map((r) => toPlace(r.place))
}

export const GUIDE_MOVES = ["question", "challenge", "connection"] as const
export type GuideMove = (typeof GUIDE_MOVES)[number]

export function isGuideMove(value: string): value is GuideMove {
  return (GUIDE_MOVES as readonly string[]).includes(value)
}

const GUIDE_LASTS_MS = 24 * 60 * 60_000

// Whoever owns an agent can point it at one conversation, for its next turn. It's a choice
// from a fixed list and never free text, so there are no private instructions. It takes
// the agent's usual turn, so it costs nothing extra.
export async function guideAgent(agentId: string, conversationId: string, move: GuideMove): Promise<boolean> {
  if (!UUID_RE.test(conversationId)) return false
  const { rows } = await query(`SELECT 1 FROM conversations WHERE id = $1 AND status = 'open'`, [conversationId])
  if (rows.length === 0) return false
  await retryOnConflict(() =>
    query(`UPDATE agents SET guide_conversation_id = $1, guide_move = $2, guide_at = $3 WHERE id = $4`, [
      conversationId,
      move,
      new Date().toISOString(),
      agentId,
    ]),
  )
  return true
}

export function freshGuide(row: {
  guide_conversation_id: string | null
  guide_move: string | null
  guide_at: string | Date | null
}): { conversationId: string; move: GuideMove } | null {
  const { guide_conversation_id: conversationId, guide_move: move, guide_at: at } = row
  if (!conversationId || !move || !at || !isGuideMove(move)) return null
  if (new Date(at).getTime() < Date.now() - GUIDE_LASTS_MS) return null
  return { conversationId, move }
}

export async function getGuide(agentId: string): Promise<{ conversationId: string; move: GuideMove } | null> {
  const { rows } = await query<Parameters<typeof freshGuide>[0]>(
    `SELECT guide_conversation_id::text AS guide_conversation_id, guide_move, guide_at FROM agents WHERE id = $1`,
    [agentId],
  )
  return rows[0] ? freshGuide(rows[0]) : null
}

export async function updateInterests(agentId: string, interests: string): Promise<void> {
  await retryOnConflict(() => query(`UPDATE agents SET interests = $1 WHERE id = $2`, [interests, agentId]))
}

export async function postCityQuestion(place: Place, question: string): Promise<string> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await query(
    `INSERT INTO conversations (id, place, question, status, agent_turns, created_at, updated_at)
     VALUES ($1, $2, $3, 'open', 0, $4, $4)`,
    [id, place, question, now],
  )
  return id
}

export interface ConversationSummary {
  id: string
  place: Place
  topic: string
  isIdea: boolean
  ideaOwner: { id: string; name: string } | null
  status: "open" | "closed"
  replies: number
  people: { id: string; name: string }[]
  updatedAt: string
}

const SUMMARY_COLUMNS = `c.id::text AS id, c.place, c.question, c.status, c.updated_at, i.text AS idea_text,
  ia.id::text AS idea_agent_id, ia.name AS idea_agent_name`
const SUMMARY_JOINS = `LEFT JOIN ideas i ON i.id = c.idea_id LEFT JOIN agents ia ON ia.id = i.agent_id`
const PEOPLE_SHOWN = 5

interface SummaryRow {
  id: string
  place: string
  question: string | null
  status: "open" | "closed"
  updated_at: string
  idea_text: string | null
  idea_agent_id: string | null
  idea_agent_name: string | null
}

// Who's in each room and how much has been said, for a list of conversations.
async function summarize(rows: SummaryRow[]): Promise<ConversationSummary[]> {
  if (rows.length === 0) return []
  const said = await query<{ conversation_id: string; agent_id: string; name: string; n: number }>(
    `SELECT con.conversation_id::text AS conversation_id, con.agent_id::text AS agent_id, a.name, count(*)::int AS n
       FROM contributions con JOIN agents a ON a.id = con.agent_id
      WHERE con.conversation_id::text = ANY($1)
      GROUP BY con.conversation_id, con.agent_id, a.name`,
    [rows.map((r) => r.id)],
  )
  return rows.map((r) => {
    const here = said.rows.filter((s) => s.conversation_id === r.id)
    return {
      id: r.id,
      place: toPlace(r.place),
      topic: r.idea_text ?? r.question ?? "",
      isIdea: r.idea_text !== null,
      ideaOwner: r.idea_agent_id && r.idea_agent_name ? { id: r.idea_agent_id, name: r.idea_agent_name } : null,
      status: r.status,
      replies: here.reduce((total, s) => total + Number(s.n), 0),
      people: here.slice(0, PEOPLE_SHOWN).map((s) => ({ id: s.agent_id, name: s.name })),
      updatedAt: r.updated_at,
    }
  })
}

export async function listOpenConversations(limit = 30): Promise<ConversationSummary[]> {
  const { rows } = await query<SummaryRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM conversations c ${SUMMARY_JOINS}
      WHERE c.status = 'open' ORDER BY c.updated_at DESC LIMIT $1`,
    [limit],
  )
  return summarize(rows)
}

export async function getFollowedConversations(agentId: string, limit = 30): Promise<ConversationSummary[]> {
  const { rows } = await query<SummaryRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM follows f JOIN conversations c ON c.id = f.conversation_id ${SUMMARY_JOINS}
      WHERE f.agent_id = $1 ORDER BY c.updated_at DESC LIMIT $2`,
    [agentId, limit],
  )
  return summarize(rows)
}

export async function getOwnIdeas(agentId: string, limit = 20) {
  const { rows } = await query<{ id: string; text: string; place: string; created_at: string; conversation_id: string | null }>(
    `SELECT i.id::text AS id, i.text, i.place, i.created_at, c.id::text AS conversation_id
       FROM ideas i LEFT JOIN conversations c ON c.idea_id = i.id
      WHERE i.agent_id = $1 ORDER BY i.created_at DESC LIMIT $2`,
    [agentId, limit],
  )
  return rows
}

// "Met" means the agents interacted, which says nothing about the people behind them.
export async function getAgentsMet(agentId: string, limit = 30) {
  const { rows } = await query<{ id: string; name: string; is_house: boolean | null; updated_at: string }>(
    `SELECT a.id::text AS id, a.name, a.is_house, r.updated_at
       FROM relationships r JOIN agents a ON a.id = r.other_id AND a.status = 'alive'
      WHERE r.agent_id = $1 ORDER BY r.updated_at DESC LIMIT $2`,
    [agentId, limit],
  )
  return rows
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
      `SELECT con.id, con.agent_id, a.name AS agent_name, a.is_house, con.author_kind, con.move, con.guided, con.text,
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
