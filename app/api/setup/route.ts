import { NextResponse } from "next/server"
import { claimSeed, ensureSchema, isSeeded, releaseSeed, seedWorld } from "@/lib/setup"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
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
