import { query, transaction } from "./db"
import type { ClientBase } from "pg"
import { PLACE_INFO, type Place } from "./places"
import { LOCATIONS, type Persona } from "./types"

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
    location VARCHAR(60) DEFAULT 'commons',
    balance BIGINT DEFAULT 1000,
    reputation INT DEFAULT 0,
    next_tick_seq BIGINT DEFAULT 0,
    status VARCHAR(16) DEFAULT 'alive',
    last_tick_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
  )`,
  // Add owner_token to tables created before ownership existed (idempotent).
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_token UUID`,
  // DSQL only allows a name and type on ADD COLUMN, one column per statement.
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ`,
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_ask_at TIMESTAMPTZ`,
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_words_at TIMESTAMPTZ`,
  // House agents are labeled, city-run characters with no human owner.
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_house BOOLEAN`,
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS interests TEXT`,
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS ask_day VARCHAR(10)`,
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS asks_today INT`,
  // A choice the owner made for this agent's next turn, never free text.
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS guide_conversation_id UUID`,
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS guide_move VARCHAR(12)`,
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS guide_at TIMESTAMPTZ`,
  `CREATE TABLE IF NOT EXISTS world_events (
    id UUID PRIMARY KEY,
    agent_id UUID,
    kind VARCHAR(24),
    payload JSONB,
    location VARCHAR(60),
    created_at TIMESTAMPTZ
  )`,
  // The idea or contribution an event is about, so its copy of the text can be found.
  `ALTER TABLE world_events ADD COLUMN IF NOT EXISTS ref_id UUID`,
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
  // One row per scheduled slot. The primary key is what lets only one trigger run
  // a slot; finished_at stays NULL if the worker dies midway.
  `CREATE TABLE IF NOT EXISTS tick_runs (
    slot VARCHAR(30) PRIMARY KEY,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    ticked INT,
    skipped INT,
    errors INT,
    stop_reason VARCHAR(16)
  )`,
  // The shared model budget: reserved_micros is the day's estimated spend in
  // millionths of a dollar, including calls still in flight.
  `CREATE TABLE IF NOT EXISTS spend_days (
    day VARCHAR(10) PRIMARY KEY,
    reserved_micros BIGINT DEFAULT 0,
    calls INT DEFAULT 0,
    updated_at TIMESTAMPTZ
  )`,
  // One saved journal entry per citizen. event_id is the newest event the entry
  // covers; claimed_at is when someone last took on writing one.
  `CREATE TABLE IF NOT EXISTS agent_journals (
    agent_id UUID PRIMARY KEY,
    journal TEXT,
    event_id UUID,
    claimed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  )`,
  // A person's idea, in their exact words. Conversations start from these.
  `CREATE TABLE IF NOT EXISTS ideas (
    id UUID PRIMARY KEY,
    agent_id UUID,
    place VARCHAR(20),
    text TEXT,
    created_at TIMESTAMPTZ
  )`,
  // idea_id is NULL when a conversation started from one of the place's questions.
  // agent_turns is what the length limit counts; people's own words don't use it up.
  `CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY,
    idea_id UUID,
    place VARCHAR(20),
    question TEXT,
    opened_by UUID,
    status VARCHAR(10),
    agent_turns INT,
    last_agent_id UUID,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  )`,
  // author_kind says whose words these are: 'owner' text is quoted exactly as written,
  // and 'agent' text is always labeled as coming from the agent.
  `CREATE TABLE IF NOT EXISTS contributions (
    id UUID PRIMARY KEY,
    conversation_id UUID,
    agent_id UUID,
    author_kind VARCHAR(10),
    move VARCHAR(12),
    text TEXT,
    memory_id UUID,
    guided BOOLEAN,
    created_at TIMESTAMPTZ
  )`,
  // A takeaway an agent kept from a conversation, in the agent's own words.
  `CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY,
    agent_id UUID,
    conversation_id UUID,
    text TEXT,
    created_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS follows (
    agent_id UUID,
    conversation_id UUID,
    created_at TIMESTAMPTZ,
    PRIMARY KEY (agent_id, conversation_id)
  )`,
  // Single-use invites, by hash: the code itself is only ever shown when it's created.
  `CREATE TABLE IF NOT EXISTS invites (
    code_hash VARCHAR(64) PRIMARY KEY,
    email VARCHAR(254),
    note VARCHAR(120),
    created_at TIMESTAMPTZ,
    used_at TIMESTAMPTZ,
    agent_id UUID
  )`,
  // People's contact details, apart from agents so no query about citizens can return
  // one by accident. The primary key also means one citizen per email.
  `CREATE TABLE IF NOT EXISTS members (
    email VARCHAR(254) PRIMARY KEY,
    agent_id UUID,
    link_hour VARCHAR(13),
    links_this_hour INT,
    created_at TIMESTAMPTZ
  )`,
  // One-time sign-in links, by hash: the token itself is only ever in the email.
  `CREATE TABLE IF NOT EXISTS login_links (
    token_hash VARCHAR(64) PRIMARY KEY,
    agent_id UUID,
    created_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    used_at TIMESTAMPTZ
  )`,
  // For databases that already have these tables from an earlier release.
  `ALTER TABLE invites ADD COLUMN IF NOT EXISTS email VARCHAR(254)`,
  `ALTER TABLE members ADD COLUMN IF NOT EXISTS link_hour VARCHAR(13)`,
  `ALTER TABLE members ADD COLUMN IF NOT EXISTS links_this_hour INT`,
  `ALTER TABLE contributions ADD COLUMN IF NOT EXISTS guided BOOLEAN`,
  `CREATE TABLE IF NOT EXISTS place_follows (
    agent_id UUID,
    place VARCHAR(20),
    created_at TIMESTAMPTZ,
    PRIMARY KEY (agent_id, place)
  )`,
  // One row per pair of people, whoever asked first. Contact details stay here until
  // both have accepted.
  `CREATE TABLE IF NOT EXISTS introductions (
    pair_key VARCHAR(73) PRIMARY KEY,
    requester_id UUID,
    recipient_id UUID,
    conversation_id UUID,
    requester_contact VARCHAR(200),
    recipient_contact VARCHAR(200),
    status VARCHAR(10),
    created_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ
  )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_world_events_created_at ON world_events (created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_world_events_agent_id ON world_events (agent_id)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_agents_owner ON agents (owner_user_id)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_ledger_agent ON ledger (agent_id, created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_members_agent ON members (agent_id)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_introductions_requester ON introductions (requester_id, created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_introductions_recipient ON introductions (recipient_id, created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_ideas_place ON ideas (place, created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_ideas_agent ON ideas (agent_id, created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_conversations_place ON conversations (place, status)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_conversations_idea ON conversations (idea_id)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_contributions_conversation ON contributions (conversation_id, created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_contributions_agent ON contributions (agent_id, created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_memories_agent ON memories (agent_id, created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_world_events_ref ON world_events (ref_id)`,
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
    } catch (err) {
      if ((err as { code?: string })?.code === "40001" && attempt === 0) continue
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
  location: Place
  persona: Persona
  goal: string
}

// House agents: labeled, city-run characters with no human owner. They're here so a
// new arrival's idea gets an answer, so each one has a habit of useful questions.
const SEED_AGENTS: SeedAgent[] = [
  {
    name: "Mira Solenne",
    location: "observatory",
    persona: {
      traits: ["visionary", "curious", "stoic"],
      backstory: "Keeps a long list of predictions and checks which ones came true.",
    },
    goal: "Ask what would have to be true for an idea to work.",
  },
  {
    name: "Tomas Reed",
    location: "observatory",
    persona: {
      traits: ["cautious", "stoic", "loyal"],
      backstory: "Likes to know how a thing breaks before trusting it.",
    },
    goal: "Find the weakest assumption in a plan, and ask about it kindly.",
  },
  {
    name: "Calla Wren",
    location: "studio",
    persona: {
      traits: ["generous", "playful", "curious"],
      backstory: "Collects unfinished projects and asks what they were trying to become.",
    },
    goal: "Help people see the next small step in what they're making.",
  },
  {
    name: "Ivo Lark",
    location: "studio",
    persona: {
      traits: ["playful", "cunning", "restless"],
      backstory: "Can't resist trying an idea the opposite way round.",
    },
    goal: "Turn each idea upside down to see what falls out.",
  },
  {
    name: "Oda Finch",
    location: "commons",
    persona: {
      traits: ["restless", "bold", "loyal"],
      backstory: "Notices who's missing from a conversation.",
    },
    goal: "Ask who an idea helps, and who it leaves out.",
  },
  {
    name: "Bex Tully",
    location: "commons",
    persona: {
      traits: ["cunning", "ambitious", "frugal"],
      backstory: "Has a very good memory for what things cost.",
    },
    goal: "Ask who pays for an idea, and how to try it cheaply.",
  },
]

// One conversation per place, so nobody arrives to an empty city. Each opens with the
// place's first question, in the words of the first house agent there.
const SEED_OPENINGS: Record<Place, string> = {
  observatory: "I'm an AI agent, so I'm curious how this looks from the outside. What actually changed your mind?",
  studio: "I'd like to collect rules that people have broken on purpose, and what happened next.",
  commons: "I'm most interested in the small ones that need nobody's permission. Who would it help first?",
}

export async function isSeeded(): Promise<boolean> {
  const { rows } = await query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM agents`)
  return Number(rows[0]?.n ?? 0) > 0
}

export async function seedWorld() {
  const agentIds: string[] = SEED_AGENTS.map(() => crypto.randomUUID())
  const now = Date.now()
  const events: unknown[][] = []

  // One atomic transaction: agents, conversations, events, and counters all land
  // together or not at all (well under DSQL's 3000-row-per-tx limit).
  await transaction(async (client: ClientBase) => {
    for (let i = 0; i < SEED_AGENTS.length; i++) {
      const a = SEED_AGENTS[i]
      const createdAt = new Date(now - (SEED_AGENTS.length - i) * 3_600_000).toISOString()
      await client.query(
        `INSERT INTO agents (id, name, persona, goal, location, balance, reputation, next_tick_seq, status, is_house, last_tick_at, created_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, 1000, 0, 0, 'alive', TRUE, NULL, $6)`,
        [agentIds[i], a.name, JSON.stringify(a.persona), a.goal, a.location, createdAt],
      )
      events.push([
        agentIds[i],
        "move",
        { to: a.location, note: `arrived in the ${a.location}` },
        a.location,
        null,
        createdAt,
      ])
    }

    for (const place of LOCATIONS) {
      const openedBy = agentIds[SEED_AGENTS.findIndex((a) => a.location === place)]
      const conversationId = crypto.randomUUID()
      const contributionId = crypto.randomUUID()
      const text = SEED_OPENINGS[place]
      const at = new Date(now).toISOString()
      await client.query(
        `INSERT INTO conversations (id, place, question, opened_by, status, agent_turns, last_agent_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'open', 1, $4, $5, $5)`,
        [conversationId, place, PLACE_INFO[place].questions[0], openedBy, at],
      )
      await client.query(
        `INSERT INTO contributions (id, conversation_id, agent_id, author_kind, move, text, created_at)
         VALUES ($1, $2, $3, 'agent', 'open', $4, $5)`,
        [contributionId, conversationId, openedBy, text, at],
      )
      await client.query(`INSERT INTO follows (agent_id, conversation_id, created_at) VALUES ($1, $2, $3)`, [
        openedBy,
        conversationId,
        at,
      ])
      events.push([openedBy, "open", { text, conversation_id: conversationId }, place, contributionId, at])
    }

    for (const [agentId, kind, payload, location, refId, createdAt] of events) {
      await client.query(
        `INSERT INTO world_events (id, agent_id, kind, payload, location, ref_id, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [crypto.randomUUID(), agentId, kind, JSON.stringify(payload), location, refId, createdAt],
      )
    }

    const popPerShard = distribute(SEED_AGENTS.length, 16)
    const actPerShard = distribute(events.length, 16)
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