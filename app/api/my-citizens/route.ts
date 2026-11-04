// app/api/my-citizens/route.ts
// Recovers every citizen this browser has spawned. Citizens spawned before the
// multi-citizen list existed were never saved to localStorage (the old code
// overwrote a single value), but each spawn left an httpOnly `polis-own-<agentId>`
// cookie whose value is the owner token. We resolve those — verifying the token —
// so the nav can rebuild the full "my citizens" list. The owner token is only
// used to prove ownership server-side; it is never returned to the client.
import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { ownerPairs } from "@/lib/owner-cookies"
import { getOwnedAgents } from "@/lib/queries"

export const dynamic = "force-dynamic"

export async function GET() {
  const pairs = ownerPairs((await cookies()).getAll())

  if (pairs.length === 0) return NextResponse.json({ citizens: [] })

  try {
    const citizens = await getOwnedAgents(pairs)
    return NextResponse.json({ citizens })
  } catch (err) {
    console.error("[polis] my-citizens recovery error:", err)
    // 500 (not empty 200) so the client leaves recovery unmarked and retries.
    return NextResponse.json({ error: "recovery failed" }, { status: 500 })
  }
}
