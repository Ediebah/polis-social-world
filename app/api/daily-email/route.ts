import { NextResponse } from "next/server"
import { hasBearerSecret } from "@/lib/auth"
import { sendDailyEmails } from "@/lib/digest"

export const dynamic = "force-dynamic"
// Must stay above RUN_TIME_LIMIT_MS in lib/digest.ts.
export const maxDuration = 120

// Called on the same schedule as the tick (see .github/workflows/world-tick.yml). Extra calls
// are harmless, because each person can only be claimed once a day.
export async function GET(req: Request) {
  if (!hasBearerSecret(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await sendDailyEmails()) })
  } catch (err) {
    console.error("[polis] daily email route error:", err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
