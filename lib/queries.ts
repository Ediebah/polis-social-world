import type { ClientBase } from "pg"
import { query, transaction } from "./db"
import type { Agent, FeedItem, Persona, WorldCounts, WorldEvent } from "./types"

const COUNTER_SHARDS = 16

// Columns of `agents` that are safe to read into the app / send to clients.
// Deliberately excludes owner_token so the ownership secret never leaks.
const AGENT_COLUMNS =
  "id, owner_user_id, name, persona, goal, location, balance, reputation, next_tick_seq, status, last_tick_at, created_at"

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  return typeof v === "number" ? v : Number(v)
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback
  if (typeof v === "object") return v as T
  try {
    return JSON.parse(String(v)) as T
  } catch {
    return fallback
  }
}

export async function getWorldCounts(): Promise<WorldCounts> {
  const { rows } = await query<{ counter_name: string; total: string }>(
    `SELECT counter_name, SUM(value) AS total
       FROM world_counters
      WHERE counter_name IN ('population', 'total_actions')
      GROUP BY counter_name`,
  )
  const counts: WorldCounts = { population: 0, total_actions: 0 }
  for (const r of rows) {
    if (r.counter_name === "population") counts.population = toNum(r.total)
    if (r.counter_name === "total_actions") counts.total_actions = toNum(r.total)
  }
  return counts
}

export async function getFeed(limit = 40): Promise<FeedItem[]> {
  const { rows } = await query<FeedItem & { payload: unknown }>(
    `SELECT we.id, we.agent_id, we.kind, we.payload, we.location, we.created_at,
            a.name AS agent_name
       FROM world_events we
       JOIN agents a ON a.id = we.agent_id
      ORDER BY we.created_at DESC
      LIMIT $1`,
    [limit],
  )
  return rows.map((r) => ({ ...r, payload: parseJson(r.payload, {}) }))
}

export async function getAgentById(id: string): Promise<Agent | null> {
  const { rows } = await query<Agent & { persona: unknown }>(
    `SELECT ${AGENT_COLUMNS} FROM agents WHERE id = $1`,
    [id],
  )
  if (rows.length === 0) return null
  const a = rows[0]
  return {
    ...a,
    balance: toNum(a.balance),
    reputation: toNum(a.reputation),
    next_tick_seq: toNum(a.next_tick_seq),
    persona: parseJson<Persona>(a.persona, { traits: [], backstory: "" }),
  }
}

export async function getAgentEvents(agentId: string, limit = 20): Promise<WorldEvent[]> {
  const { rows } = await query<WorldEvent & { payload: unknown }>(
    `SELECT id, agent_id, kind, payload, location, created_at
       FROM world_events
      WHERE agent_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [agentId, limit],
  )
  return rows.map((r) => ({ ...r, payload: parseJson(r.payload, {}) }))
}

export async function listAgents(limit = 12): Promise<Pick<Agent, "id" | "name" | "location">[]> {
  const { rows } = await query<Pick<Agent, "id" | "name" | "location">>(
    `SELECT id, name, location FROM agents ORDER BY created_at DESC LIMIT $1`,
    [limit],
  )
  return rows
}

// Increments a random shard of a sharded counter, inside the caller's tx.
// Upserts so the increment lands even if the shard row was never seeded.
async function bumpCounter(client: ClientBase, counter: string, delta = 1) {
  const shard = Math.floor(Math.random() * COUNTER_SHARDS)
  await client.query(
    `INSERT INTO world_counters (counter_name, shard, value) VALUES ($1, $2, $3)
     ON CONFLICT (counter_name, shard) DO UPDATE SET value = world_counters.value + EXCLUDED.value`,
    [counter, shard, delta],
  )
}

export interface SpawnInput {
  handle: string
  name: string
  traits: string[]
  backstory: string
  goal: string
  location: string
}

export interface SpawnResult {
  id: string
  // Secret proof of ownership, stored on the agent row and handed to the
  // spawner (via an httpOnly cookie) so only they can nudge this citizen.
  ownerToken: string
}

export async function spawnAgent(input: SpawnInput): Promise<SpawnResult> {
  const userId = crypto.randomUUID()
  const agentId = crypto.randomUUID()
  const eventId = crypto.randomUUID()
  const ownerToken = crypto.randomUUID()
  const persona: Persona = { traits: input.traits, backstory: input.backstory }
  const now = new Date().toISOString()

  // One atomic transaction: agent, owner, arrival event, and counters either all
  // land or none do — no orphan agents and no counter drift on partial failure.
  await transaction(async (client) => {
    await client.query(`INSERT INTO users (id, handle, created_at) VALUES ($1, $2, $3)`, [
      userId,
      input.handle,
      now,
    ])
    await client.query(
      `INSERT INTO agents (id, owner_user_id, owner_token, name, persona, goal, location, balance, reputation, next_tick_seq, status, last_tick_at, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 1000, 0, 0, 'alive', NULL, $8)`,
      [agentId, userId, ownerToken, input.name, JSON.stringify(persona), input.goal, input.location, now],
    )
    await client.query(
      `INSERT INTO world_events (id, agent_id, kind, payload, location, created_at)
       VALUES ($1, $2, 'move', $3::jsonb, $4, $5)`,
      [
        eventId,
        agentId,
        JSON.stringify({ to: input.location, note: `arrived in the ${input.location}` }),
        input.location,
        now,
      ],
    )
    await bumpCounter(client, "population", 1)
    await bumpCounter(client, "total_actions", 1)
  })

  return { id: agentId, ownerToken }
}

// True only if `token` matches the agent's stored owner_token. Used to gate
// nudges and the "your citizen" UI — there is no login, so the cookie-held
// token is the proof of ownership.
export async function ownsAgent(agentId: string, token: string | null | undefined): Promise<boolean> {
  if (!agentId || !token) return false
  const { rows } = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM agents WHERE id = $1 AND owner_token = $2 LIMIT 1`,
    [agentId, token],
  )
  return rows.length > 0
}

export async function nudgeAgentGoal(agentId: string, goal: string): Promise<void> {
  const agent = await getAgentById(agentId)
  if (!agent) throw new Error("Agent not found")
  const now = new Date().toISOString()
  await transaction(async (client) => {
    await client.query(`UPDATE agents SET goal = $1 WHERE id = $2`, [goal, agentId])
    await client.query(
      `INSERT INTO world_events (id, agent_id, kind, payload, location, created_at)
       VALUES ($1, $2, 'post', $3::jsonb, $4, $5)`,
      [
        crypto.randomUUID(),
        agentId,
        JSON.stringify({ text: `reconsidered its purpose: "${goal}"` }),
        agent.location,
        now,
      ],
    )
    await bumpCounter(client, "total_actions", 1)
  })
}
