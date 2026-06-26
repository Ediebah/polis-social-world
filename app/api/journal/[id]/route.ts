// app/api/journal/[id]/route.ts
// A short, first-person "what I did" recap for a citizen, written by Claude from
// its recent events. Cached in-memory per warm instance (TTL) so repeated views
// don't re-spend on the model.
import { NextResponse } from "next/server"
import { generateText } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { query } from "@/lib/db"
import { eventSummary, stripMarkdown } from "@/lib/format"

export const dynamic = "force-dynamic"

const MODEL = anthropic("claude-haiku-4-5-20251001")
const TTL_MS = 90_000
const cache = new Map<string, { text: string; at: number; lastEventAt: string | null }>()

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback
  if (typeof v === "object") return v as T
  try {
    return JSON.parse(String(v)) as T
  } catch {
    return fallback
  }
}

// Plain-prose recap built with no AI, used as a fallback when the model call
// fails, times out, or returns nothing — so the card degrades to a readable
// summary instead of vanishing. Takes the events newest-first (as fetched),
// uses the most recent few, and reads them back in chronological order.
function buildDigest(rows: { kind: string; payload: unknown }[]): string {
  const parts = rows
    .slice(0, 5)
    .reverse()
    .map((e) => eventSummary({ kind: e.kind, payload: parseJson<Record<string, unknown>>(e.payload, {}) }).trim())
    .filter(Boolean)
  if (parts.length === 0) return ""
  const joined =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const cached = cache.get(id)
    if (cached && Date.now() - cached.at < TTL_MS) {
      return NextResponse.json({ journal: cached.text, lastEventAt: cached.lastEventAt })
    }

    const agentRes = await query<{ name: string; persona: unknown; goal: string }>(
      `SELECT name, persona, goal FROM agents WHERE id = $1`,
      [id],
    )
    const agent = agentRes.rows[0]
    if (!agent) return NextResponse.json({ journal: "", lastEventAt: null })

    const evRes = await query<{ kind: string; payload: unknown; location: string; created_at: string }>(
      `SELECT kind, payload, location, created_at FROM world_events
        WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 15`,
      [id],
    )
    if (evRes.rows.length === 0) {
      const empty = "Nothing has happened yet. The day is still ahead of me."
      cache.set(id, { text: empty, at: Date.now(), lastEventAt: null })
      return NextResponse.json({ journal: empty, lastEventAt: null })
    }

    // Newest event first in the result; capture its time for the UI dateline.
    const lastEventAt = evRes.rows[0].created_at

    const persona = parseJson<{ traits?: string[]; backstory?: string }>(agent.persona, {})
    const lines = [...evRes.rows]
      .reverse()
      .map((e) => {
        const p = parseJson<Record<string, unknown>>(e.payload, {})
        const detail = p.text ?? p.note ?? (p.item ? `${p.item}${p.price ? ` for ${p.price}` : ""}` : "") ?? ""
        const wth = p.with ? ` with ${p.with}` : ""
        return `- ${e.kind} in ${e.location}${wth}: ${String(detail)}`
      })
      .join("\n")

    let journal: string
    let fromModel = false
    try {
      const { text } = await generateText({
        model: MODEL,
        maxRetries: 2,
        timeout: { totalMs: 20_000 },
        system:
          "You write a SHORT first-person journal entry (2 to 4 sentences) for a citizen of Polis, " +
          "looking back on their recent day. In their voice, vivid but grounded. Plain prose only — " +
          "no markdown, headings, titles, or bullet points. No preamble, no surrounding quotes, no " +
          "mention of being an AI. Just the entry.",
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
      const cleaned = stripMarkdown(text)
      if (cleaned) {
        journal = cleaned
        fromModel = true
      } else {
        journal = buildDigest(evRes.rows)
      }
    } catch (err) {
      // Model failed/timed out — fall back to the plain-prose digest.
      console.error("[polis] journal model fallback:", err)
      journal = buildDigest(evRes.rows)
    }

    // Only cache real model output; let a digest fallback retry the model on the
    // next visit so a transient blip self-heals instead of sticking for the TTL.
    if (fromModel) cache.set(id, { text: journal, at: Date.now(), lastEventAt })
    return NextResponse.json({ journal, lastEventAt })
  } catch (err) {
    console.error("[polis] journal error:", err)
    return NextResponse.json({ journal: "", lastEventAt: null })
  }
}