import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { toPlace } from "@/lib/places"
import { LOCATIONS } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const { rows } = await query<{ location: string; count: number }>(
      `SELECT location, COUNT(*)::int AS count
         FROM agents
        WHERE status = 'alive'
        GROUP BY location`,
    )
    const byLocation: Record<string, number> = {}
    // Citizens from before the three places still count, in the Commons.
    for (const r of rows) byLocation[toPlace(r.location)] = (byLocation[toPlace(r.location)] ?? 0) + Number(r.count)

    const districts = LOCATIONS.map((name) => ({ name, count: byLocation[name] ?? 0 }))
    const total = districts.reduce((sum, d) => sum + d.count, 0)

    return NextResponse.json({ districts, total })
  } catch (err) {
    console.error("[polis] citymap error:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}