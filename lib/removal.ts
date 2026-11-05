import type { ClientBase } from "pg"
import { query, transaction } from "./db"
import { retryOnConflict } from "./occ"
import { bumpCounter, UUID_RE } from "./queries"

// Text someone takes back has to leave every page, prompt and email. The rows that hold a
// conversation together stay, blanked, and the feed's copies are deleted so nothing can
// read them. Screens show a placeholder for any blank text.

// Shorter than this, a match says nothing about whether an agent was quoting.
const MIN_QUOTE = 12
// About a sentence, so a common phrase doesn't take an unrelated reply with it.
const QUOTED_WORDS = 8

function inOneTransaction<T>(fn: (client: ClientBase, now: string) => Promise<T>): Promise<T> {
  return retryOnConflict(() => transaction((client) => fn(client, new Date().toISOString())))
}

function forgetJournals(client: ClientBase, agentIds: string[], now: string) {
  return client.query(`UPDATE agent_journals SET journal = NULL, event_id = NULL, updated_at = $1 WHERE agent_id::text = ANY($2)`, [
    now,
    agentIds,
  ])
}

async function blankContributions(client: ClientBase, ids: string[], now: string): Promise<void> {
  if (ids.length === 0) return
  const blanked = await client.query<{ agent_id: string; conversation_id: string }>(
    `UPDATE contributions SET text = '', withdrawn_at = $1 WHERE id::text = ANY($2)
     RETURNING agent_id::text AS agent_id, conversation_id::text AS conversation_id`,
    [now, ids],
  )
  await client.query(`DELETE FROM world_events WHERE ref_id::text = ANY($1)`, [ids])
  // A write to the row every agent turn there also writes, so a turn at this same moment
  // conflicts with this. Whichever goes second then sees what the other did.
  await client.query(`UPDATE conversations SET updated_at = updated_at WHERE id::text = ANY($1)`, [blanked.rows.map((r) => r.conversation_id)])
  // A saved journal is written from what its agent said, so it could repeat any of this.
  await forgetJournals(client, blanked.rows.map((r) => r.agent_id), now)
}

async function deleteTakeaways(client: ClientBase, ids: string[], now: string): Promise<void> {
  if (ids.length === 0) return
  await client.query(`DELETE FROM memories WHERE id::text = ANY($1)`, [ids])
  // Anything an agent wrote drawing on one of these carries it into another room.
  const citing = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM contributions WHERE memory_id::text = ANY($1) AND withdrawn_at IS NULL`,
    [ids],
  )
  await blankContributions(client, citing.rows.map((r) => r.id), now)
}

async function removeIdeaText(client: ClientBase, ideaId: string, now: string): Promise<void> {
  await client.query(`UPDATE ideas SET text = '', withdrawn_at = $1 WHERE id = $2`, [now, ideaId])
  await client.query(`DELETE FROM world_events WHERE ref_id = $1`, [ideaId])

  const conversations = await client.query<{ id: string }>(`SELECT id::text AS id FROM conversations WHERE idea_id = $1`, [ideaId])
  for (const { id } of conversations.rows) {
    await client.query(`UPDATE conversations SET status = 'closed', updated_at = $1 WHERE id = $2`, [now, id])
    await client.query(`DELETE FROM follows WHERE conversation_id = $1`, [id])
    // Everything an agent said here answered the idea, so any of it could repeat it. People's
    // own words stay, since those are theirs to withdraw.
    const replies = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM contributions WHERE conversation_id = $1 AND author_kind = 'agent' AND withdrawn_at IS NULL`,
      [id],
    )
    await blankContributions(client, replies.rows.map((r) => r.id), now)
    const takeaways = await client.query<{ id: string }>(`SELECT id::text AS id FROM memories WHERE conversation_id = $1`, [id])
    await deleteTakeaways(client, takeaways.rows.map((r) => r.id), now)
  }
}

const wordsOf = (text: string) => text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

// Text being taken back, and where it could have been read from.
interface TakenBack {
  text: string
  created_at: string
  conversation_id: string | null
}

interface AgentText {
  id: string
  text: string
  conversation_id: string
  created_at: string
}

// People choose what they write, and withdrawing shouldn't let them erase anyone else's
// agent. So nothing older than the text can count, since it can't be quoting it. A sentence
// counts anywhere, while something shorter could be a common phrase and only counts in the
// room it was said in, in full.
function quotesAny(taken: TakenBack[]): (row: AgentText) => boolean {
  const checks = taken.map(({ text, created_at, conversation_id }) => {
    const words = wordsOf(text)
    const isSentence = words.length >= QUOTED_WORDS
    return {
      after: new Date(created_at).getTime(),
      room: isSentence ? null : conversation_id,
      phrases: isSentence
        ? Array.from({ length: words.length - QUOTED_WORDS + 1 }, (_, i) => ` ${words.slice(i, i + QUOTED_WORDS).join(" ")} `)
        : words.join(" ").length >= MIN_QUOTE
          ? [` ${words.join(" ")} `]
          : [],
    }
  })
  return (row) => {
    const said = ` ${wordsOf(row.text).join(" ")} `
    const at = new Date(row.created_at).getTime()
    return checks.some(
      (check) => at > check.after && (check.room === null || check.room === row.conversation_id) && check.phrases.some((phrase) => said.includes(phrase)),
    )
  }
}

// Agents are told never to repeat people, which won't always hold, and they can do it in any
// room. Rewording can't be detected, which is why the pages offering this say so.
async function removeQuotes(client: ClientBase, taken: TakenBack[], now: string): Promise<void> {
  const quotes = quotesAny(taken)
  const replies = await client.query<AgentText>(
    `SELECT id::text AS id, text, conversation_id::text AS conversation_id, created_at FROM contributions
      WHERE author_kind = 'agent' AND withdrawn_at IS NULL`,
  )
  await blankContributions(client, replies.rows.filter(quotes).map((r) => r.id), now)
  const takeaways = await client.query<AgentText>(
    `SELECT id::text AS id, text, conversation_id::text AS conversation_id, created_at FROM memories`,
  )
  await deleteTakeaways(client, takeaways.rows.filter(quotes).map((r) => r.id), now)
}

const IDEA_TEXT = "text, created_at, NULL::text AS conversation_id"
const CONTRIBUTION_TEXT = "text, created_at, conversation_id::text AS conversation_id"

export function withdrawIdea(agentId: string, ideaId: string): Promise<boolean> {
  if (!UUID_RE.test(ideaId)) return Promise.resolve(false)
  return inOneTransaction(async (client, now) => {
    const idea = await client.query<TakenBack>(`SELECT ${IDEA_TEXT} FROM ideas WHERE id = $1 AND agent_id = $2 AND withdrawn_at IS NULL`, [ideaId, agentId])
    if (idea.rows.length === 0) return false
    await removeIdeaText(client, ideaId, now)
    await removeQuotes(client, idea.rows, now)
    return true
  })
}

export function withdrawWords(agentId: string, contributionId: string): Promise<boolean> {
  if (!UUID_RE.test(contributionId)) return Promise.resolve(false)
  return inOneTransaction(async (client, now) => {
    const { rows } = await client.query<TakenBack>(
      `SELECT ${CONTRIBUTION_TEXT} FROM contributions
        WHERE id = $1 AND agent_id = $2 AND author_kind = 'owner' AND withdrawn_at IS NULL`,
      [contributionId, agentId],
    )
    if (rows.length === 0) return false
    await blankContributions(client, [contributionId], now)
    await removeQuotes(client, rows, now)
    return true
  })
}

// For the founder, after a report.
export function removeContribution(contributionId: string): Promise<boolean> {
  if (!UUID_RE.test(contributionId)) return Promise.resolve(false)
  return inOneTransaction(async (client, now) => {
    const { rows } = await client.query<TakenBack & { author_kind: string }>(
      `SELECT author_kind, ${CONTRIBUTION_TEXT} FROM contributions WHERE id = $1 AND withdrawn_at IS NULL`,
      [contributionId],
    )
    if (rows.length === 0) return false
    await blankContributions(client, [contributionId], now)
    if (rows[0].author_kind === "owner") await removeQuotes(client, rows, now)
    return true
  })
}

// For the founder, after a report.
export function removeIdea(ideaId: string): Promise<boolean> {
  if (!UUID_RE.test(ideaId)) return Promise.resolve(false)
  return inOneTransaction(async (client, now) => {
    const idea = await client.query<TakenBack>(`SELECT ${IDEA_TEXT} FROM ideas WHERE id = $1 AND withdrawn_at IS NULL`, [ideaId])
    if (idea.rows.length === 0) return false
    await removeIdeaText(client, ideaId, now)
    await removeQuotes(client, idea.rows, now)
    return true
  })
}

// One transaction, so a failure leaves the account whole. A person's rows are bounded by the
// agent's turn limit, so a two-week pilot stays far under the database's 3,000-row limit.
export function deleteAccount(agentId: string): Promise<boolean> {
  if (!UUID_RE.test(agentId)) return Promise.resolve(false)
  return inOneTransaction(async (client, now) => {
    const agent = await client.query<{ owner_user_id: string | null }>(
      `SELECT owner_user_id::text AS owner_user_id FROM agents
        WHERE id = $1 AND status IN ('alive', 'suspended') AND is_house IS NOT TRUE`,
      [agentId],
    )
    if (agent.rows.length === 0) return false

    const ideas = await client.query<TakenBack & { id: string }>(
      `SELECT id::text AS id, ${IDEA_TEXT} FROM ideas WHERE agent_id = $1 AND withdrawn_at IS NULL`,
      [agentId],
    )
    for (const { id } of ideas.rows) await removeIdeaText(client, id, now)

    const said = await client.query<TakenBack & { id: string }>(
      `SELECT id::text AS id, ${CONTRIBUTION_TEXT} FROM contributions WHERE agent_id = $1 AND withdrawn_at IS NULL`,
      [agentId],
    )
    await blankContributions(client, said.rows.map((c) => c.id), now)
    await removeQuotes(client, [...ideas.rows, ...said.rows], now)

    const kept = await client.query<{ id: string }>(`SELECT id::text AS id FROM memories WHERE agent_id = $1`, [agentId])
    await deleteTakeaways(client, kept.rows.map((r) => r.id), now)

    await client.query(`DELETE FROM world_events WHERE agent_id = $1`, [agentId])
    await client.query(`DELETE FROM agent_journals WHERE agent_id = $1`, [agentId])
    await client.query(`DELETE FROM follows WHERE agent_id = $1`, [agentId])
    await client.query(`DELETE FROM place_follows WHERE agent_id = $1`, [agentId])
    await client.query(`DELETE FROM relationships WHERE agent_id = $1 OR other_id = $1`, [agentId])
    await client.query(`DELETE FROM introductions WHERE requester_id = $1 OR recipient_id = $1`, [agentId])
    await client.query(`DELETE FROM login_links WHERE agent_id = $1`, [agentId])
    await client.query(`DELETE FROM reports WHERE reporter_id = $1`, [agentId])

    const member = await client.query<{ email: string }>(`DELETE FROM members WHERE agent_id = $1 RETURNING email`, [agentId])
    await client.query(`UPDATE invites SET email = NULL, note = NULL WHERE email = ANY($1) OR agent_id = $2`, [
      member.rows.map((r) => r.email),
      agentId,
    ])
    if (agent.rows[0].owner_user_id) await client.query(`DELETE FROM users WHERE id = $1`, [agent.rows[0].owner_user_id])

    await client.query(
      `UPDATE agents
          SET name = 'Former citizen', persona = '{"traits":[],"backstory":""}'::jsonb, goal = '', interests = NULL,
              owner_token = NULL, owner_user_id = NULL, status = 'deleted', paused_at = NULL,
              guide_conversation_id = NULL, guide_move = NULL, guide_at = NULL
        WHERE id = $1`,
      [agentId],
    )
    await bumpCounter(client, "population", -1)
    return true
  })
}

// Reversible, so nothing is blanked: their words are hidden when they're read, and come back
// exactly as they were if this is lifted.
export async function setSuspended(agentId: string, suspended: boolean): Promise<boolean> {
  if (!UUID_RE.test(agentId)) return false
  const [from, to] = suspended ? ["alive", "suspended"] : ["suspended", "alive"]
  const r = await retryOnConflict(() => query(`UPDATE agents SET status = $1 WHERE id = $2 AND status = $3`, [to, agentId, from]))
  return r.rowCount === 1
}

export async function setAgentPaused(agentId: string, paused: boolean): Promise<void> {
  await retryOnConflict(() => query(`UPDATE agents SET paused_at = $1 WHERE id = $2`, [paused ? new Date().toISOString() : null, agentId]))
}
