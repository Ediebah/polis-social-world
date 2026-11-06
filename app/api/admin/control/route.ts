// Operator controls, protected by ADMIN_SECRET. GET reports today's estimated spend
// and whether the city is paused. POST { "paused": true | false } stops or resumes
// every model call, and takes effect immediately with no redeploy.
import { NextResponse } from "next/server"
import { hasBearerSecret } from "@/lib/auth"
import { getLastUpdateAt } from "@/lib/scheduler"
import { getSpendStatus, setPaused } from "@/lib/spend"

export const dynamic = "force-dynamic"

const unauthorized = () => NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })

export async function GET(req: Request) {
  if (!hasBearerSecret(req, process.env.ADMIN_SECRET)) return unauthorized()
  try {
    const [status, lastUpdateAt] = await Promise.all([getSpendStatus(), getLastUpdateAt()])
    return NextResponse.json({ ok: true, ...status, lastUpdateAt })
  } catch (err) {
    console.error("[polis] control status error:", err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  if (!hasBearerSecret(req, process.env.ADMIN_SECRET)) return unauthorized()
  const body = await req.json().catch(() => null)
  if (typeof body?.paused !== "boolean") {
    return NextResponse.json({ ok: false, error: 'send { "paused": true } or { "paused": false }' }, { status: 400 })
  }
  try {
    await setPaused(body.paused)
    return NextResponse.json({ ok: true, paused: body.paused })
  } catch (err) {
    console.error("[polis] control update error:", err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
