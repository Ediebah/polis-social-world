import { NextResponse } from "next/server"
import { ensureSchema, isSeeded, seedWorld } from "@/lib/setup"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  try {
    await ensureSchema()
    const seeded = await isSeeded()
    if (!seeded) {
      await seedWorld()
    }
    return NextResponse.json({ ok: true, schema: "ready", seeded: !seeded ? "seeded" : "already-seeded" })
  } catch (err) {
    console.error("[v0] setup error:", err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
