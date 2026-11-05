import { NextResponse, type NextRequest } from "next/server"
import { unsubscribe } from "@/lib/digest"

export const dynamic = "force-dynamic"

// Mail clients post here when someone uses their own unsubscribe button (RFC 8058), so it
// can't ask for a cookie. It can only turn email off, and says the same whatever it's given.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  await unsubscribe(token).catch((err) => console.error("[polis] unsubscribe error:", err))
  return NextResponse.json({ ok: true })
}
