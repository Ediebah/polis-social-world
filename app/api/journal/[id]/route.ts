// app/api/journal/[id]/route.ts
// A short, first-person "what I did" recap for a citizen, written by Claude from
// its recent events. Cached in-memory per warm instance (TTL) so repeated views
// don't re-spend on the model.
import { NextResponse } from "next/server"
import { generateText } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

const MODEL = anthropic("claude-haiku-4-5-20251001")
const TTL_MS = 90_000
const cache = new Map<string, { text: string; at: number }>()

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback
  if (typeof v === "object") return v as T
  try {
    return JSON.parse(String(v)) as T
  } catch {
    return fallback
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const cached = cache.get(id)
    if (cached && Date.now() - cached.at < TTL_MS) {
      return NextResponse.json({ journal: cached.text })
    }

    const agentRes = await query<{ name: string; persona: unknown; goal: string }>(
      `SELECT name, persona, goal FROM agents WHERE id = $1`,
      [id],
    )
    const agent = agentRes.rows[0]
    if (!agent) return NextResponse.json({ journal: "" })

    const evRes = await query<{ kind: string; payload: unknown; location: string }>(
      `SELECT kind, payload, location FROM world_events
        WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 15`,
      [id],
    )
    if (evRes.rows.length === 0) {
      const empty = "Nothing has happened yet. The day is still ahead of me."
      cache.set(id, { text: empty, at: Date.now() })
      return NextResponse.json({ journal: empty })
    }

    const persona = parseJson<{ traits?: string[]; backstory?: string }>(agent.persona, {})
    const lines = evRes.rows
      .reverse()
      .map((e) => {
        const p = parseJson<Record<string, unknown>>(e.payload, {})
        const detail = p.text ?? p.note ?? (p.item ? `${p.item}${p.price ? ` for ${p.price}` : ""}` : "") ?? ""
        const wth = p.with ? ` with ${p.with}` : ""
        return `- ${e.kind} in ${e.location}${wth}: ${String(detail)}`
      })
      .join("\n")

    const { text } = await generateText({
      model: MODEL,
      maxRetries: 2,
      system:
        "You write a SHORT first-person journal entry (2 to 4 sentences) for a citizen of Polis, " +
        "looking back on their recent day. In their voice, vivid but grounded. No preamble, no " +
        "surrounding quotes, no mention of being an AI. Just the entry.",
      prompt: [
        `I am ${agent.name}.`,
        `Traits: ${(persona.traits ?? []).join(", ") || "unspecified"}.`,
        `My goal: ${agent.goal}.`,
        "",
        "What I did recently, oldest to newest:",
        lines,
        "",
        "Write my journal entry looking back on this.",
      ].join("\n"),
    })

    const journal = text.trim()
    cache.set(id, { text: journal, at: Date.now() })
    return NextResponse.json({ journal })
  } catch (err) {
    console.error("[polis] journal error:", err)
    return NextResponse.json({ journal: "" })
  }
}