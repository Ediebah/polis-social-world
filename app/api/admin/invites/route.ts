import { NextResponse, type NextRequest } from "next/server"
import { hasBearerSecret } from "@/lib/auth"
import { createInvites, inviteCounts } from "@/lib/members"

export const dynamic = "force-dynamic"

const MAX_AT_ONCE = 50

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}

export async function GET(req: NextRequest) {
  if (!hasBearerSecret(req, process.env.ADMIN_SECRET)) return unauthorized()
  return NextResponse.json(await inviteCounts())
}

// The links are only ever shown here, because only their hashes are stored.
export async function POST(req: NextRequest) {
  if (!hasBearerSecret(req, process.env.ADMIN_SECRET)) return unauthorized()

  const body = await req.json().catch(() => null)
  const count = body?.count
  if (!Number.isInteger(count) || count < 1 || count > MAX_AT_ONCE) {
    return NextResponse.json({ error: `count must be a whole number from 1 to ${MAX_AT_ONCE}` }, { status: 400 })
  }
  const note = typeof body.note === "string" ? body.note.slice(0, 120) : null

  const codes = await createInvites(count, note)
  const { origin } = new URL(req.url)
  return NextResponse.json({ links: codes.map((code) => `${origin}/join/${code}`) })
}
