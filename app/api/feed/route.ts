import { NextResponse } from "next/server"
import { getFeed, getWorldCounts } from "@/lib/queries"
import { getLastUpdateAt } from "@/lib/scheduler"

export const dynamic = "force-dynamic"

// Read-only: polling this never advances the world or spends on the model.
export async function GET() {
  try {
    const [feed, counts, lastUpdateAt] = await Promise.all([
      getFeed(40),
      getWorldCounts(),
      getLastUpdateAt().catch(() => null),
    ])
    return NextResponse.json({ feed, counts, lastUpdateAt })
  } catch (err) {
    console.error("[v0] feed error:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
