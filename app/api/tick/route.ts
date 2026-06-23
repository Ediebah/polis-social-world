import { NextResponse } from "next/server"
import { advanceWorld } from "@/lib/heartbeat"
import { runTick } from "@/lib/simulation"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// On-demand advance (the "advance the world" button). Public, but routed through
// advanceWorld() so its cooldown bounds how often it can actually spend on the
// model — repeated clicks/requests return { throttled: true } instead of ticking.
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url)
  const count = Math.max(1, Math.min(6, Number(searchParams.get("count")) || 3))
  try {
    const result = await advanceWorld(count)
    if ("throttled" in result) {
      return NextResponse.json({ ok: true, throttled: true, ticked: 0, skipped: 0, errors: 0 })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error("[v0] tick route error:", err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}

// Vercel Cron entry point. Cron is a privileged trigger, so it must present the
// CRON_SECRET (Vercel sends it automatically as `Authorization: Bearer <secret>`).
// Without a configured + matching secret this is rejected, so it can't be used
// by the public to run up model spend.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get("authorization")
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }
  try {
    const result = await runTick(3)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error("[v0] tick cron error:", err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
