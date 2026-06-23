import { NextResponse } from "next/server"
import { runTick } from "@/lib/simulation"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url)
  const count = Math.max(1, Math.min(6, Number(searchParams.get("count")) || 3))
  try {
    const result = await runTick(count)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error("[v0] tick route error:", err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}

// Allow Vercel Cron (GET) to advance the world automatically.
export async function GET() {
  try {
    const result = await runTick(3)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error("[v0] tick cron error:", err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
