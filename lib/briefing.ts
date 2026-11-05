import { query } from "./db"
import { getIntroductions, type IntroPerson } from "./introductions"
import type { Place } from "./places"
import { toPlace } from "./places"
import { inHiddenRoom } from "./queries"

const BRIEFING_DAYS = 7
const BRIEFING_ITEMS = 8
const BRIEFING_TAKEAWAYS = 3

export interface BriefingItem {
  id: string
  conversation_id: string
  agent_id: string
  agent_name: string
  is_house: boolean | null
  author_kind: "agent" | "owner"
  move: string | null
  guided: boolean | null
  text: string
  place: string
  created_at: string
}

export interface Briefing {
  items: BriefingItem[]
  takeaways: { id: string; text: string; conversation_id: string; created_at: string }[]
  waitingForYou: IntroPerson[]
}

// What's been said in the conversations someone follows, leaving out their own words.
export async function followedActivity(agentId: string, since: string, until: string, limit: number): Promise<BriefingItem[]> {
  const { rows } = await query<BriefingItem>(
    `SELECT con.id::text AS id, con.conversation_id::text AS conversation_id, con.agent_id::text AS agent_id,
            a.name AS agent_name, a.is_house, con.author_kind, con.move, con.guided, con.text, c.place, con.created_at
       FROM follows f
       JOIN contributions con ON con.conversation_id = f.conversation_id
       JOIN conversations c ON c.id = con.conversation_id
       JOIN agents a ON a.id = con.agent_id AND a.status = 'alive'
      WHERE f.agent_id = $1 AND con.created_at > $2 AND con.created_at <= $3 AND con.withdrawn_at IS NULL
        AND NOT (con.agent_id = $1 AND con.author_kind = 'owner')
        AND NOT ${inHiddenRoom("con.conversation_id")}
      ORDER BY con.created_at DESC, con.id DESC
      LIMIT $4`,
    [agentId, since, until, limit],
  )
  return rows
}

// Built only from stored records, and every item links back to one. If nothing happened
// the lists are empty, and the screen says so.
export async function getBriefing(agentId: string): Promise<Briefing> {
  const since = new Date(Date.now() - BRIEFING_DAYS * 24 * 60 * 60_000).toISOString()
  const [items, takeaways, introductions] = await Promise.all([
    followedActivity(agentId, since, new Date().toISOString(), BRIEFING_ITEMS),
    query<Briefing["takeaways"][number]>(
      `SELECT m.id::text AS id, m.text, m.conversation_id::text AS conversation_id, m.created_at
         FROM memories m WHERE m.agent_id = $1 AND m.created_at > $2 AND NOT ${inHiddenRoom("m.conversation_id")}
        ORDER BY m.created_at DESC LIMIT $3`,
      [agentId, since, BRIEFING_TAKEAWAYS],
    ),
    getIntroductions(agentId),
  ])
  return { items, takeaways: takeaways.rows, waitingForYou: introductions.incoming }
}

// One the city posted comes first. Otherwise the newest open question, so the screen
// always has something real to offer until the daily questions start.
export async function getTodaysQuestion(): Promise<{ id: string; place: Place; question: string } | null> {
  const { rows } = await query<{ id: string; place: string; question: string }>(
    `SELECT id::text AS id, place, question FROM conversations
      WHERE status = 'open' AND idea_id IS NULL AND question IS NOT NULL
      ORDER BY (opened_by IS NULL) DESC, created_at DESC
      LIMIT 1`,
  )
  return rows[0] ? { ...rows[0], place: toPlace(rows[0].place) } : null
}
