import { NextResponse } from "next/server"
import { hasBearerSecret } from "@/lib/auth"
import { runScheduledSlot } from "@/lib/scheduler"

export const dynamic = "force-dynamic"
// Must stay above RUN_TIME_LIMIT_MS in lib/scheduler.ts.
export const maxDuration = 120

// The scheduler's entry point (see .github/workflows/world-tick.yml). It's the only
// way to advance the world, so it requires CRON_SECRET, sent as
// `Authorization: Bearer <secret>`. Extra triggers are harmless: each 15-minute
// slot runs once.
export async function GET(req: Request) {
  if (!hasBearerSecret(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }
  try {
    const run = await runScheduledSlot()
    return NextResponse.json({ ok: true, ...run })
  } catch (err) {
    console.error("[polis] scheduled tick error:", err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
