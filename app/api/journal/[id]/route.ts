// app/api/journal/[id]/route.ts
// A short, first-person "what I did" recap for a citizen, written by Claude from
// its recent events. Entries are saved and only rewritten once the citizen has done
// something new, so what this spends follows what citizens do, not how often anyone
// looks.
import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { eventSummary, stripMarkdown } from "@/lib/format"
import { retryOnConflict } from "@/lib/occ"
import { generateWithinBudget, SpendBlockedError } from "@/lib/spend"

export const dynamic = "force-dynamic"

const MAX_JOURNAL_TOKENS = 300

type JournalAgent = { name: string; persona: unknown; goal: string }
type JournalEvent = { id: string; kind: string; payload: unknown; location: string; created_at: string }

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

// Only the visitor who claims a citizen's newest event writes its entry, so many
// people opening a citizen at once still make one model call.
function claimEntry(agentId: string, eventId: string): Promise<boolean> {
  const now = new Date().toISOString()
  return retryOnConflict(async () => {
    await query(
      `INSERT INTO agent_journals (agent_id, updated_at) VALUES ($1, $2)
       ON CONFLICT (agent_id) DO NOTHING`,
      [agentId, now],
    )
    const r = await query(
      `UPDATE agent_journals SET claimed_event_id = $2, updated_at = $3
        WHERE agent_id = $1 AND (claimed_event_id IS NULL OR claimed_event_id <> $2)`,
      [agentId, eventId, now],
    )
    return (r.rowCount ?? 0) === 1
  })
}

function releaseClaim(agentId: string, eventId: string) {
  return query(
    `UPDATE agent_journals SET claimed_event_id = NULL, updated_at = $3
      WHERE agent_id = $1 AND claimed_event_id = $2`,
    [agentId, eventId, new Date().toISOString()],
  )
}

// Matching the claim means a slower writer can't replace an entry for a newer event.
function saveEntry(agentId: string, eventId: string, journal: string) {
  return retryOnConflict(() =>
    query(
      `UPDATE agent_journals SET journal = $3, event_id = $2, updated_at = $4
        WHERE agent_id = $1 AND claimed_event_id = $2`,
      [agentId, eventId, journal, new Date().toISOString()],
    ),
  )
}

async function writeEntry(agent: JournalAgent, events: JournalEvent[]): Promise<string> {
  const persona = parseJson<{ traits?: string[]; backstory?: string }>(agent.persona, {})
  const lines = [...events]
    .reverse()
    .map((e) => {
      const p = parseJson<Record<string, unknown>>(e.payload, {})
      const detail = p.text ?? p.note ?? (p.item ? `${p.item}${p.price ? ` for ${p.price}` : ""}` : "") ?? ""
      const wth = p.with ? ` with ${p.with}` : ""
      return `- ${e.kind} in ${e.location}${wth}: ${String(detail)}`
    })
    .join("\n")

  const { text } = await generateWithinBudget("journal", {
    maxOutputTokens: MAX_JOURNAL_TOKENS,
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
  return stripMarkdown(text)
}

// The saved entry if it's current, a new one if this visitor gets to write it, and
// otherwise nothing. Never calls the model without holding the claim.
async function currentEntry(agentId: string, agent: JournalAgent, events: JournalEvent[]): Promise<string> {
  const newestId = events[0].id
  const saved = await query<{ journal: string | null; event_id: string | null }>(
    `SELECT journal, event_id FROM agent_journals WHERE agent_id = $1`,
    [agentId],
  )
  if (saved.rows[0]?.event_id === newestId && saved.rows[0].journal) return saved.rows[0].journal
  if (!(await claimEntry(agentId, newestId))) return ""

  let entry = ""
  try {
    entry = await writeEntry(agent, events)
  } finally {
    // Failed or came back empty, so the next visitor can try again.
    if (!entry) await releaseClaim(agentId, newestId).catch(() => {})
  }
  if (entry) await saveEntry(agentId, newestId, entry)
  return entry
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const agentRes = await query<JournalAgent>(`SELECT name, persona, goal FROM agents WHERE id = $1`, [id])
    const agent = agentRes.rows[0]
    if (!agent) return NextResponse.json({ journal: "", lastEventAt: null })

    // id breaks ties, so "newest event" is the same on every read.
    const evRes = await query<JournalEvent>(
      `SELECT id, kind, payload, location, created_at FROM world_events
        WHERE agent_id = $1 ORDER BY created_at DESC, id DESC LIMIT 15`,
      [id],
    )
    if (evRes.rows.length === 0) {
      return NextResponse.json({ journal: "Nothing has happened yet. The day is still ahead of me.", lastEventAt: null })
    }

    // Newest event first in the result; capture its time for the UI dateline.
    const lastEventAt = evRes.rows[0].created_at

    let journal = ""
    try {
      journal = await currentEntry(id, agent, evRes.rows)
    } catch (err) {
      // Model failed/timed out, saved entries are unreachable, or the city is paused or
      // over budget — fall back to the plain-prose digest.
      if (!(err instanceof SpendBlockedError)) console.error("[polis] journal model fallback:", err)
    }
    return NextResponse.json({ journal: journal || buildDigest(evRes.rows), lastEventAt })
  } catch (err) {
    console.error("[polis] journal error:", err)
    return NextResponse.json({ journal: "", lastEventAt: null })
  }
}
