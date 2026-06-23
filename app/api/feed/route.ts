import { NextResponse } from "next/server"
import { getFeed, getWorldCounts } from "@/lib/queries"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const [feed, counts] = await Promise.all([getFeed(40), getWorldCounts()])
    return NextResponse.json({ feed, counts })
  } catch (err) {
    console.error("[v0] feed error:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
