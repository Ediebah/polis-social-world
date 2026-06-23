import { generateText, Output } from "ai"
import { z } from "zod"
import { query, withConnection } from "./db"
import type { Agent, Persona } from "./types"
import { LOCATIONS } from "./types"

const MODEL = "openai/gpt-5.4-mini"

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
}

const ActionSchema = z.object({
  type: z.enum(["post", "move", "listing", "trade", "reflect"]),
  // A single short, present-tense line of in-world narration (no quotes, no agent name prefix).
  text: z.string(),
  // Destination for a "move"; otherwise null.
  to: z.enum(LOCATIONS).nullable(),
  // For a "listing": the item and price; otherwise null.
  item: z.string().nullable(),
  price: z.number().int().nullable(),
  // For a "trade"/social action: the name of another citizen involved; otherwise null.
  with_agent: z.string().nullable(),
})

type AgentAction = z.infer<typeof ActionSchema>

async function selectAgentsForTick(limit: number): Promise<TickAgent[]> {
  // Oldest-acted agents first (NULLS treated as oldest via COALESCE).
  const { rows } = await query<Agent & { persona: unknown }>(
    `SELECT id, name, persona, goal, location, balance, reputation, last_tick_at
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
    "- trade: interact with a specific nearby citizen (set 'with_agent' to their name)",
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

function clampPrice(p: number | null): number {
  if (!p || !Number.isFinite(p)) return 25
  return Math.max(1, Math.min(9999, Math.round(p)))
}

async function applyAction(agent: TickAgent, action: AgentAction) {
  const now = new Date().toISOString()
  let kind = action.type
  let location = agent.location
  const payload: Record<string, unknown> = {}

  switch (action.type) {
    case "move": {
      const to = action.to && action.to !== agent.location ? action.to : pickOtherLocation(agent.location)
      payload.from = agent.location
      payload.to = to
      payload.note = action.text
      location = to
      break
    }
    case "listing": {
      payload.item = action.item ?? "a small curiosity"
      payload.price = clampPrice(action.price)
      payload.text = action.text
      break
    }
    case "trade": {
      payload.with = action.with_agent ?? "a passerby"
      payload.text = action.text
      kind = "trade"
      break
    }
    case "reflect": {
      payload.text = action.text
      kind = "reflect"
      break
    }
    case "post":
    default: {
      payload.text = action.text
      kind = "post"
      break
    }
  }

  await withConnection(async (client) => {
    await client.query(
      `INSERT INTO world_events (id, agent_id, kind, payload, location, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [crypto.randomUUID(), agent.id, kind, JSON.stringify(payload), location, now],
    )
    await client.query(`UPDATE agents SET location = $1, last_tick_at = $2 WHERE id = $3`, [
      location,
      now,
      agent.id,
    ])
  })

  await bumpActions(1)
}

function pickOtherLocation(current: string): string {
  const others = LOCATIONS.filter((l) => l !== current)
  return others[Math.floor(Math.random() * others.length)]
}

async function bumpActions(delta: number) {
  const shard = Math.floor(Math.random() * 16)
  await query(`UPDATE world_counters SET value = value + $1 WHERE counter_name = 'total_actions' AND shard = $2`, [
    delta,
    shard,
  ])
}

export interface TickResult {
  ticked: number
  errors: number
}

export async function runTick(count = 3): Promise<TickResult> {
  const agents = await selectAgentsForTick(count)
  let ticked = 0
  let errors = 0

  // Sequential to respect DSQL transaction limits and keep ordering readable.
  for (const agent of agents) {
    try {
      const action = await decideAction(agent)
      await applyAction(agent, action)
      ticked++
    } catch (err) {
      console.error("[v0] tick error for agent", agent.name, err)
      errors++
    }
  }

  return { ticked, errors }
}
