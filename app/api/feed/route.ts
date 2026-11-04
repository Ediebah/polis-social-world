import { NextResponse } from "next/server"
import { getFeed, getWorldCounts } from "@/lib/queries"
import { getLastUpdateAt } from "@/lib/scheduler"
import { memberRoute } from "@/lib/members"

export const dynamic = "force-dynamic"

// Read-only: polling this never advances the world or spends on the model.
export const GET = memberRoute(async () => {
  try {
    const [feed, counts, lastUpdateAt] = await Promise.all([
      getFeed(40),
      getWorldCounts(),
      getLastUpdateAt().catch(() => null),
    ])
    return NextResponse.json({ feed, counts, lastUpdateAt })
  } catch (err) {
    console.error("[v0] feed error:", err)
    return NextResponse.json({ error: "unavailable" }, { status: 500 })
  }
})
