// app/api/ask/[id]/route.ts
// Lets a citizen's owner ask it a question and get a short, in-character answer
// spoken in first person, grounded in what the agent has actually been doing.
// Mirrors the data-gathering in app/api/journal/[id]/route.ts.
import { NextResponse } from "next/server"
import { generateText } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

const MODEL = anthropic("claude-haiku-4-5-20251001")
const MAX_QUESTION = 280

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback
  if (typeof v === "object") return v as T
  try {
    return JSON.parse(String(v)) as T
  } catch {
    return fallback
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json().catch(() => ({}))
    const question = String(body?.question ?? "").trim().slice(0, MAX_QUESTION)
    if (!question) return NextResponse.json({ answer: "" })

    const agentRes = await query<{ name: string; persona: unknown; goal: string }>(
      `SELECT name, persona, goal FROM agents WHERE id = $1`,
      [id],
    )
    const agent = agentRes.rows[0]
    if (!agent) return NextResponse.json({ answer: "" })

    const evRes = await query<{ kind: string; payload: unknown; location: string }>(
      `SELECT kind, payload, location FROM world_events
        WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 15`,
      [id],
    )

    const persona = parseJson<{ traits?: string[]; backstory?: string }>(agent.persona, {})
    const lines = evRes.rows
      .slice()
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
      timeout: { totalMs: 20_000 },
      system:
        "You ARE this citizen of Polis, answering your owner's question out loud. " +
        "Speak in first person, in character, in 1 to 3 short conversational sentences, " +
        "grounded in what you have actually been doing. No preamble, no surrounding " +
        "quotes, no mention of being an AI.",
      prompt: [
        `I am ${agent.name}.`,
        `Traits: ${(persona.traits ?? []).join(", ") || "unspecified"}.`,
        `My goal: ${agent.goal}.`,
        "",
        lines ? "What I have been doing recently, oldest to newest:" : "I have not done much yet.",
        lines,
        "",
        `Someone asks me: "${question}"`,
        "Answer them now, in my own voice.",
      ].join("\n"),
    })

    return NextResponse.json({ answer: text.trim() })
  } catch (err) {
    console.error("[polis] ask error:", err)
    return NextResponse.json({ answer: "" })
  }
}
