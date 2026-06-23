import { NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { getFeed, getWorldCounts } from "@/lib/queries"
import { maybeTick } from "@/lib/heartbeat"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const [feed, counts] = await Promise.all([getFeed(40), getWorldCounts()])

    // Advance the world in the background, throttled. Because the feed is polled
    // continuously by everyone watching, this keeps the world alive without paid
    // cron — and the cooldown in maybeTick() bounds how often it actually ticks.
    // waitUntil runs after the response is sent, so the feed stays fast.
    waitUntil(maybeTick())

    return NextResponse.json({ feed, counts })
  } catch (err) {
    console.error("[v0] feed error:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}