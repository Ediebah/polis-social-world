import { generateText, Output } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { z } from "zod"
import { query, withConnection } from "./db"
import type { Agent, Persona } from "./types"
import { LOCATIONS } from "./types"

// Claude via the Anthropic API directly (reads ANTHROPIC_API_KEY from env).
const MODEL = anthropic("claude-haiku-4-5-20251001")

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
  text: z.string(),
  to: z.enum(LOCATIONS).nullable(),
  item: z.string().nullable(),
  price: z.number().int().nullable(),
  with_agent: z.string().nullable(),
})

type AgentAction = z.infer<typeof ActionSchema>

async function selectAgentsForTick(limit: number): Promise<TickAgent[]> {
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
    // Bound how long (and how hard) we wait on the model so one slow/looping
    // call can't tie up the tick or the feed's background work.
    maxRetries: 2,
    timeout: { totalMs: 20_000 },
  })
  return experimental_output
}

// Returns a price in [1, max], or 0 when the agent cannot afford anything
// (max < 1). Returning 0 — rather than clamping up to 1 — keeps the invariant
// that the result never exceeds max, so a broke agent can't "spend" coins.
function clampPrice(p: number | null, max: number): number {
  if (max < 1) return 0
  const base = !p || !Number.isFinite(p) ? Math.min(25, max) : Math.round(p)
  return Math.max(1, Math.min(max, base))
}

function pickOtherLocation(current: string): string {
  const others = LOCATIONS.filter((l) => l !== current)
  return others[Math.floor(Math.random() * others.length)]
}

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

// Strengthen the directed bond a -> b. Atomic upsert keyed on the composite
// primary key (agent_id, other_id), so concurrent first-time bonds between the
// same pair can't create duplicate rows that would double-count sentiment.
// Runs inside the trade tx.
async function bumpRelationship(
  client: any,
  a: string,
  b: string,
  delta: number,
  reason: string,
  now: string,
) {
  await client.query(
    `INSERT INTO relationships (agent_id, other_id, sentiment, last_reason, updated_at)
     VALUES ($1, $2, LEAST(100, GREATEST(-100, $3)), $4, $5)
     ON CONFLICT (agent_id, other_id) DO UPDATE
        SET sentiment = LEAST(100, GREATEST(-100, relationships.sentiment + EXCLUDED.sentiment)),
            last_reason = EXCLUDED.last_reason,
            updated_at = EXCLUDED.updated_at`,
    [a, b, delta, reason, now],
  )
}

type CommitOutcome = { status: "ok"; kind: string } | { status: "skipped" }

async function commitAction(agent: TickAgent, action: AgentAction): Promise<CommitOutcome> {
  const now = new Date().toISOString()

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

        // Doing business builds a bond, recorded both directions.
        await bumpRelationship(client, agent.id, seller.id, 8, "traded", now)
        await bumpRelationship(client, seller.id, agent.id, 8, "traded", now)

        payload.with = seller.name
        payload.price = price
        kind = "trade"
      } else if (action.type === "trade") {
        kind = "post"
        payload.text = `eyes ${payload.item ?? "the goods"} but holds onto their coins`
        delete payload.item
      }

      await client.query(
        `INSERT INTO world_events (id, agent_id, kind, payload, location, created_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
        [crypto.randomUUID(), agent.id, kind, JSON.stringify(payload), location, now],
      )

      // Upsert so the increment still lands if this shard was never seeded.
      await client.query(
        `INSERT INTO world_counters (counter_name, shard, value) VALUES ('total_actions', $1, 1)
         ON CONFLICT (counter_name, shard) DO UPDATE SET value = world_counters.value + 1`,
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