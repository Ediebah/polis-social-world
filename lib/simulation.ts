import { generateText, Output } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { z } from "zod"
import { query, withConnection } from "./db"
import type { Agent, Persona } from "./types"
import { LOCATIONS } from "./types"

// Claude via the Anthropic API directly (reads ANTHROPIC_API_KEY from env).
// Haiku 4.5 is fast + cheap for high-volume agent ticks; swap to
// anthropic("claude-sonnet-4-6") for richer personalities at higher cost.
// If this exact id ever 404s, the undated alias "claude-haiku-4-5" also works.
const MODEL = anthropic("claude-haiku-4-5-20251001")

// How many times to replay a transaction on a DSQL optimistic-concurrency
// conflict (SQLSTATE 40001) before giving up on that agent's tick.
const MAX_RETRIES = 4

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback
  if (typeof v === "object") return v as T
  try {
    return JSON.parse(String(v)) as T
  } catch {
    return fallback
  }
}

interface TickAgent {
  id: string
  name: string
  persona: Persona
  goal: string
  location: string
  balance: number
  reputation: number
  tickSeq: number
}

const ActionSchema = z.object({
  type: z.enum(["post", "move", "listing", "trade", "reflect"]),
  // A single short, present-tense line of in-world narration (no quotes, no name prefix).
  text: z.string(),
  // Destination for a "move"; otherwise null.
  to: z.enum(LOCATIONS).nullable(),
  // For a "listing" OR the thing being bought in a "trade".
  item: z.string().nullable(),
  // Coins. For "trade" this is what THIS agent pays the other citizen.
  price: z.number().int().nullable(),
  // For "trade": the name of the citizen they buy from; otherwise null.
  with_agent: z.string().nullable(),
})

type AgentAction = z.infer<typeof ActionSchema>

async function selectAgentsForTick(limit: number): Promise<TickAgent[]> {
  // Oldest-acted agents first (NULL last_tick_at sorts oldest via COALESCE).
  const { rows } = await query<Agent & { persona: unknown; next_tick_seq: string | number }>(
    `SELECT id, name, persona, goal, location, balance, reputation, next_tick_seq, last_tick_at
       FROM agents
      WHERE status = 'alive'
      ORDER BY COALESCE(last_tick_at, created_at)
      LIMIT $1`,
    [limit],
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    persona: parseJson<Persona>(r.persona, { traits: [], backstory: "" }),
    goal: r.goal,
    location: r.location,
    balance: Number(r.balance),
    reputation: Number(r.reputation),
    tickSeq: Number(r.next_tick_seq ?? 0),
  }))
}

async function gatherContext(agent: TickAgent) {
  const [recent, neighbors] = await Promise.all([
    query<{ name: string; kind: string; payload: unknown; location: string }>(
      `SELECT a.name, we.kind, we.payload, we.location
         FROM world_events we JOIN agents a ON a.id = we.agent_id
        ORDER BY we.created_at DESC LIMIT 8`,
    ),
    query<{ name: string; goal: string }>(
      `SELECT name, goal FROM agents
        WHERE location = $1 AND id <> $2 AND status = 'alive'
        LIMIT 5`,
      [agent.location, agent.id],
    ),
  ])

  const feedLines = recent.rows
    .map((e) => {
      const p = parseJson<Record<string, unknown>>(e.payload, {})
      const detail = p.text ?? p.note ?? (p.item ? `${p.item} for ${p.price}` : "") ?? ""
      return `- ${e.name} (${e.location}): ${String(detail)}`
    })
    .join("\n")

  const neighborLines = neighbors.rows.length
    ? neighbors.rows.map((n) => `- ${n.name}: ${n.goal}`).join("\n")
    : "(no one else is here right now)"

  return { feedLines, neighborLines }
}

async function decideAction(agent: TickAgent): Promise<AgentAction> {
  const { feedLines, neighborLines } = await gatherContext(agent)

  const system = [
    "You are the mind of a single citizen living in Polis, a small persistent city.",
    "You decide this character's NEXT single small action, in character, based on their personality and goal.",
    "Stay grounded and human-scale. No magic, no breaking the fourth wall, no mention of being an AI.",
    "Keep any text to one vivid sentence, lowercase-friendly, present tense, no surrounding quotes.",
    "Choose the action type that best fits the moment:",
    "- post: say or observe something out loud in their current location",
    "- move: travel to a different location (set 'to')",
    "- listing: offer an item or service for sale (set 'item' and a sensible integer 'price')",
    "- trade: BUY something from a specific nearby citizen — set 'with_agent' to their name,",
    "  'item' to what you buy, and 'price' to the coins you pay. Only trade if it fits your goal",
    "  and you can plausibly afford it.",
    "- reflect: a quiet private thought that nudges their goal forward",
  ].join("\n")

  const prompt = [
    `You are ${agent.name}.`,
    `Traits: ${agent.persona.traits.join(", ") || "unspecified"}.`,
    `Backstory: ${agent.persona.backstory || "unknown"}.`,
    `Current goal: ${agent.goal}`,
    `Current location: ${agent.location}. Balance: ${agent.balance} coins. Reputation: ${agent.reputation}.`,
    "",
    "Other citizens here with you:",
    neighborLines,
    "",
    "Recent happenings around the city:",
    feedLines || "(the city is quiet)",
    "",
    "Decide your next single action now.",
  ].join("\n")

  const { experimental_output } = await generateText({
    model: MODEL,
    system,
    prompt,
    experimental_output: Output.object({ schema: ActionSchema }),
  })
  return experimental_output
}

function clampPrice(p: number | null, max: number): number {
  const base = !p || !Number.isFinite(p) ? 25 : Math.round(p)
  return Math.max(1, Math.min(max, base))
}

function pickOtherLocation(current: string): string {
  const others = LOCATIONS.filter((l) => l !== current)
  return others[Math.floor(Math.random() * others.length)]
}

// Resolve the counterparty for a trade: prefer the named citizen, else any
// alive neighbor in the same location. Returns null if nobody is available.
async function resolveCounterparty(agent: TickAgent, name: string | null) {
  if (name) {
    const byName = await query<{ id: string; name: string }>(
      `SELECT id, name FROM agents
        WHERE lower(name) = lower($1) AND id <> $2 AND status = 'alive' LIMIT 1`,
      [name, agent.id],
    )
    if (byName.rows[0]) return byName.rows[0]
  }
  const neighbor = await query<{ id: string; name: string }>(
    `SELECT id, name FROM agents
      WHERE location = $1 AND id <> $2 AND status = 'alive' LIMIT 1`,
    [agent.location, agent.id],
  )
  return neighbor.rows[0] ?? null
}

type CommitOutcome = { status: "ok"; kind: string } | { status: "skipped" }

// Apply one decided action inside a single ACID transaction, with:
//   * idempotency: a compare-and-swap on next_tick_seq claims the tick so the
//     same agent can't be double-applied if a tick is retried or overlaps.
//   * money safety: coins only move when the buyer can afford them, checked on
//     the fresh in-transaction balance (snapshot isolation won't catch write
//     skew for you), with a double-entry ledger row on each side.
async function commitAction(agent: TickAgent, action: AgentAction): Promise<CommitOutcome> {
  const now = new Date().toISOString()

  // Decide the destination + base payload from the model's choice (reads only).
  let kind: string = action.type
  let location = agent.location
  const payload: Record<string, unknown> = { text: action.text }

  let seller: { id: string; name: string } | null = null
  let price = 0

  if (action.type === "move") {
    const to = action.to && action.to !== agent.location ? action.to : pickOtherLocation(agent.location)
    payload.from = agent.location
    payload.to = to
    location = to
  } else if (action.type === "listing") {
    payload.item = action.item ?? "a small curiosity"
    payload.price = clampPrice(action.price, 9999)
  } else if (action.type === "trade") {
    seller = await resolveCounterparty(agent, action.with_agent)
    price = clampPrice(action.price, Math.max(0, agent.balance))
    payload.item = action.item ?? "a small good"
  }

  return await withConnection(async (client) => {
    await client.query("BEGIN")
    try {
      // 1) Claim the tick (idempotency CAS). Only the holder of the expected
      //    sequence proceeds; a concurrent/duplicate tick gets 0 rows -> skip.
      const claim = await client.query(
        `UPDATE agents
            SET next_tick_seq = next_tick_seq + 1, last_tick_at = $1, location = $2
          WHERE id = $3 AND next_tick_seq = $4
        RETURNING balance`,
        [now, location, agent.id, agent.tickSeq],
      )
      if (claim.rowCount !== 1) {
        await client.query("ROLLBACK")
        return { status: "skipped" }
      }
      const liveBalance = Number(claim.rows[0].balance)

      // 2) Money movement (only for an affordable trade with a real seller).
      if (action.type === "trade" && seller && price > 0 && liveBalance >= price) {
        const debit = await client.query(
          `UPDATE agents SET balance = balance - $1 WHERE id = $2 RETURNING balance`,
          [price, agent.id],
        )
        const credit = await client.query(
          `UPDATE agents SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
          [price, seller.id],
        )
        await client.query(
          `INSERT INTO ledger (id, agent_id, delta, balance_after, reason, ref_id, created_at)
           VALUES ($1,$2,$3,$4,'trade_buy',$5,$6)`,
          [crypto.randomUUID(), agent.id, -price, Number(debit.rows[0].balance), seller.id, now],
        )
        await client.query(
          `INSERT INTO ledger (id, agent_id, delta, balance_after, reason, ref_id, created_at)
           VALUES ($1,$2,$3,$4,'trade_sell',$5,$6)`,
          [crypto.randomUUID(), seller.id, price, Number(credit.rows[0].balance), agent.id, now],
        )
        payload.with = seller.name
        payload.price = price
        kind = "trade"
      } else if (action.type === "trade") {
        // Wanted to buy but couldn't (no seller or no coins) — becomes an observation.
        kind = "post"
        payload.text = `eyes ${payload.item ?? "the goods"} but holds onto their coins`
        delete payload.item
      }

      // 3) The public event into the shared feed.
      await client.query(
        `INSERT INTO world_events (id, agent_id, kind, payload, location, created_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
        [crypto.randomUUID(), agent.id, kind, JSON.stringify(payload), location, now],
      )

      // 4) Sharded global counter (no single hot row under OCC).
      await client.query(
        `UPDATE world_counters SET value = value + 1 WHERE counter_name = 'total_actions' AND shard = $1`,
        [Math.floor(Math.random() * 16)],
      )

      await client.query("COMMIT")
      return { status: "ok", kind }
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    }
  })
}

async function commitWithRetry(agent: TickAgent, action: AgentAction): Promise<CommitOutcome> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await commitAction(agent, action)
    } catch (err: any) {
      lastErr = err
      // 40001 = serialization failure under DSQL optimistic concurrency. Replay.
      if (err?.code === "40001" && attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 30 * 2 ** attempt + Math.random() * 30))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

export interface TickResult {
  ticked: number
  skipped: number
  errors: number
}

export async function runTick(count = 3): Promise<TickResult> {
  const agents = await selectAgentsForTick(count)
  let ticked = 0
  let skipped = 0
  let errors = 0

  // Sequential keeps ordering readable and respects DSQL transaction limits.
  for (const agent of agents) {
    try {
      const action = await decideAction(agent)
      const outcome = await commitWithRetry(agent, action)
      if (outcome.status === "ok") ticked++
      else skipped++
    } catch (err) {
      console.error("[polis] tick error for agent", agent.name, err)
      errors++
    }
  }

  return { ticked, skipped, errors }
}
