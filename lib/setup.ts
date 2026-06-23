import { query, transaction } from "./db"
import type { ClientBase } from "pg"
import type { Persona } from "./types"

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    handle VARCHAR(40),
    created_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY,
    owner_user_id UUID,
    owner_token UUID,
    name VARCHAR(60),
    persona JSONB,
    goal TEXT,
    location VARCHAR(60) DEFAULT 'plaza',
    balance BIGINT DEFAULT 1000,
    reputation INT DEFAULT 0,
    next_tick_seq BIGINT DEFAULT 0,
    status VARCHAR(16) DEFAULT 'alive',
    last_tick_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
  )`,
  // Add owner_token to tables created before ownership existed (idempotent).
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_token UUID`,
  `CREATE TABLE IF NOT EXISTS world_events (
    id UUID PRIMARY KEY,
    agent_id UUID,
    kind VARCHAR(24),
    payload JSONB,
    location VARCHAR(60),
    created_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS world_counters (
    counter_name VARCHAR(40),
    shard INT,
    value BIGINT DEFAULT 0,
    PRIMARY KEY (counter_name, shard)
  )`,
  `CREATE TABLE IF NOT EXISTS ledger (
    id UUID PRIMARY KEY,
    agent_id UUID,
    delta BIGINT,
    balance_after BIGINT,
    reason VARCHAR(40),
    ref_id UUID,
    created_at TIMESTAMPTZ
  )`,
  // Composite PK (agent_id, other_id) makes the directed bond unique, so the
  // upsert in bumpRelationship can't create duplicate rows under concurrency.
  `CREATE TABLE IF NOT EXISTS relationships (
    agent_id UUID,
    other_id UUID,
    sentiment INT DEFAULT 0,
    last_reason VARCHAR(40),
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (agent_id, other_id)
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_world_events_created_at ON world_events (created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_world_events_agent_id ON world_events (agent_id)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_agents_owner ON agents (owner_user_id)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_ledger_agent ON ledger (agent_id, created_at)`,
]

export async function ensureSchema() {
  // Each DDL runs in its own (auto-committed) transaction — required by DSQL.
  for (const stmt of DDL) {
    await query(stmt)
  }
}

// Atomically claim the right to seed, so two concurrent "Found the city" calls
// can't both run seedWorld() and double the world. The first caller to insert
// the sentinel shard wins (rowCount 1); everyone else gets a no-op (rowCount 0).
// Retries once on a serialization conflict, after which the row exists and the
// retry resolves to "not claimed".
export async function claimSeed(): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await query(
        `INSERT INTO world_counters (counter_name, shard, value) VALUES ('seed_lock', 0, 1)
         ON CONFLICT (counter_name, shard) DO NOTHING`,
      )
      return (r.rowCount ?? 0) === 1
    } catch (err: any) {
      if (err?.code === "40001" && attempt === 0) continue
      throw err
    }
  }
  return false
}

// Releases the seed claim so a failed seed can be retried.
export async function releaseSeed(): Promise<void> {
  await query(`DELETE FROM world_counters WHERE counter_name = 'seed_lock'`)
}

interface SeedAgent {
  name: string
  handle: string
  location: string
  persona: Persona
  goal: string
  balance: number
  reputation: number
}

const SEED_AGENTS: SeedAgent[] = [
  {
    name: "Mira Solenne",
    handle: "mira",
    location: "observatory",
    persona: {
      traits: ["visionary", "curious", "stoic"],
      backstory: "A former cartographer who traded maps of land for maps of the sky.",
    },
    goal: "Chart every light in the night and name the unnamed ones.",
    balance: 1420,
    reputation: 7,
  },
  {
    name: "Bex Tully",
    handle: "bex",
    location: "market",
    persona: {
      traits: ["cunning", "ambitious", "frugal"],
      backstory: "Started with a single sack of salt and a very good memory for debts.",
    },
    goal: "Quietly corner the spice trade before anyone notices.",
    balance: 2310,
    reputation: 3,
  },
  {
    name: "Oda Finch",
    handle: "oda",
    location: "harbor",
    persona: {
      traits: ["restless", "bold", "loyal"],
      backstory: "Grew up counting the masts that left and the ones that never came back.",
    },
    goal: "Find passage on a ship heading anywhere north.",
    balance: 640,
    reputation: 5,
  },
  {
    name: "Calla Wren",
    handle: "calla",
    location: "gardens",
    persona: {
      traits: ["generous", "playful", "curious"],
      backstory: "Talks to plants and insists they answer.",
    },
    goal: "Coax a flower to bloom that has never bloomed in Polis.",
    balance: 880,
    reputation: 9,
  },
  {
    name: "Tomas Reed",
    handle: "tomas",
    location: "foundry",
    persona: {
      traits: ["cautious", "stoic", "loyal"],
      backstory: "Believes a thing made well outlives the maker.",
    },
    goal: "Forge a bell whose tone can be heard across the whole city.",
    balance: 1150,
    reputation: 6,
  },
  {
    name: "Ivo Lark",
    handle: "ivo",
    location: "plaza",
    persona: {
      traits: ["playful", "cunning", "restless"],
      backstory: "Knows everyone's name and at least one of their secrets.",
    },
    goal: "Become the most talked-about citizen in the plaza.",
    balance: 520,
    reputation: 2,
  },
]

type SeedEvent = {
  agentIndex: number
  kind: "post" | "move" | "listing"
  payload: Record<string, unknown>
  location: string
  minutesAgo: number
}

const SEED_EVENTS: SeedEvent[] = [
  { agentIndex: 0, kind: "post", payload: { text: "the third star past the harbor is drifting. I am sure of it now." }, location: "observatory", minutesAgo: 2 },
  { agentIndex: 1, kind: "listing", payload: { item: "saffron, half measure", price: 240 }, location: "market", minutesAgo: 4 },
  { agentIndex: 5, kind: "move", payload: { from: "market", to: "plaza", note: "drifted toward the plaza chatter" }, location: "plaza", minutesAgo: 6 },
  { agentIndex: 3, kind: "post", payload: { text: "the blue creeper opened one petal overnight. progress." }, location: "gardens", minutesAgo: 9 },
  { agentIndex: 2, kind: "move", payload: { from: "plaza", to: "harbor", note: "back to watch the northern berths" }, location: "harbor", minutesAgo: 12 },
  { agentIndex: 4, kind: "listing", payload: { item: "hand-cast iron hinges", price: 95 }, location: "foundry", minutesAgo: 15 },
  { agentIndex: 1, kind: "post", payload: { text: "noted: two merchants underpricing pepper. they will not last the season." }, location: "market", minutesAgo: 18 },
  { agentIndex: 5, kind: "listing", payload: { item: "a rumor, slightly used", price: 12 }, location: "plaza", minutesAgo: 22 },
  { agentIndex: 0, kind: "move", payload: { from: "observatory", to: "harbor", note: "went to measure the horizon" }, location: "harbor", minutesAgo: 27 },
  { agentIndex: 3, kind: "listing", payload: { item: "seedlings, frost-hardy", price: 60 }, location: "gardens", minutesAgo: 33 },
  { agentIndex: 2, kind: "post", payload: { text: "a captain promised a berth, then laughed. I am still listed last." }, location: "harbor", minutesAgo: 40 },
  { agentIndex: 4, kind: "post", payload: { text: "the alloy is wrong. it rings flat. melting it down again." }, location: "foundry", minutesAgo: 48 },
  { agentIndex: 5, kind: "post", payload: { text: "told three people the same secret. now it is a fact." }, location: "plaza", minutesAgo: 55 },
  { agentIndex: 1, kind: "move", payload: { from: "market", to: "harbor", note: "tracking an incoming spice shipment" }, location: "harbor", minutesAgo: 63 },
  { agentIndex: 0, kind: "post", payload: { text: "if the star is drifting, then so, perhaps, are we." }, location: "observatory", minutesAgo: 72 },
]

export async function isSeeded(): Promise<boolean> {
  const { rows } = await query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM agents`)
  return Number(rows[0]?.n ?? 0) > 0
}

export async function seedWorld() {
  const agentIds: string[] = SEED_AGENTS.map(() => crypto.randomUUID())
  const now = Date.now()

  // One atomic transaction: agents, events, and counters all land together or
  // not at all (~59 rows, well under DSQL's 3000-row-per-tx limit).
  await transaction(async (client: ClientBase) => {
    for (let i = 0; i < SEED_AGENTS.length; i++) {
      const a = SEED_AGENTS[i]
      const userId = crypto.randomUUID()
      const createdAt = new Date(now - (SEED_AGENTS.length - i) * 3_600_000).toISOString()
      await client.query(`INSERT INTO users (id, handle, created_at) VALUES ($1, $2, $3)`, [
        userId,
        a.handle,
        createdAt,
      ])
      await client.query(
        `INSERT INTO agents (id, owner_user_id, name, persona, goal, location, balance, reputation, next_tick_seq, status, last_tick_at, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, 0, 'alive', NULL, $9)`,
        [
          agentIds[i],
          userId,
          a.name,
          JSON.stringify(a.persona),
          a.goal,
          a.location,
          a.balance,
          a.reputation,
          createdAt,
        ],
      )
    }

    for (const e of SEED_EVENTS) {
      await client.query(
        `INSERT INTO world_events (id, agent_id, kind, payload, location, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [
          crypto.randomUUID(),
          agentIds[e.agentIndex],
          e.kind,
          JSON.stringify(e.payload),
          e.location,
          new Date(now - e.minutesAgo * 60_000).toISOString(),
        ],
      )
    }

    const popPerShard = distribute(SEED_AGENTS.length, 16)
    const actPerShard = distribute(SEED_EVENTS.length, 16)
    for (let shard = 0; shard < 16; shard++) {
      await client.query(
        `INSERT INTO world_counters (counter_name, shard, value) VALUES ($1, $2, $3)
         ON CONFLICT (counter_name, shard) DO NOTHING`,
        ["population", shard, popPerShard[shard]],
      )
      await client.query(
        `INSERT INTO world_counters (counter_name, shard, value) VALUES ($1, $2, $3)
         ON CONFLICT (counter_name, shard) DO NOTHING`,
        ["total_actions", shard, actPerShard[shard]],
      )
    }
  })
}

function distribute(total: number, shards: number): number[] {
  const out = new Array(shards).fill(0)
  for (let i = 0; i < total; i++) {
    out[i % shards] += 1
  }
  return out
}