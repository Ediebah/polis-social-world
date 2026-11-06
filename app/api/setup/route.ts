import { NextResponse } from "next/server"
import { hasBearerSecret } from "@/lib/auth"
import { claimSeed, ensureSchema, isSeeded, releaseSeed, seedWorld } from "@/lib/setup"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Creates or updates the schema and seeds an empty city. Safe to re-run after a
// deploy that adds tables, and protected by ADMIN_SECRET because it runs DDL.
export async function GET(req: Request) {
  if (!hasBearerSecret(req, process.env.ADMIN_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }
  try {
    await ensureSchema()

    let didSeed = false
    // claimSeed() makes this safe against concurrent setup calls: only one wins
    // the claim and seeds; the rest fall through to "already-seeded".
    if (!(await isSeeded()) && (await claimSeed())) {
      try {
        await seedWorld()
        didSeed = true
      } catch (err) {
        // Roll back the claim so a failed seed can be retried.
        await releaseSeed()
        throw err
      }
    }

    return NextResponse.json({ ok: true, schema: "ready", seeded: didSeed ? "seeded" : "already-seeded" })
  } catch (err) {
    console.error("[v0] setup error:", err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
