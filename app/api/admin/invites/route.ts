import { NextResponse, type NextRequest } from "next/server"
import { hasBearerSecret } from "@/lib/auth"
import { appUrl, emailEnabled, sendEmail } from "@/lib/email"
import { createInvites, inviteCounts } from "@/lib/members"

export const dynamic = "force-dynamic"

const MAX_AT_ONCE = 50
const MAX_EMAIL = 254
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}

export async function GET(req: NextRequest) {
  if (!hasBearerSecret(req, process.env.ADMIN_SECRET)) return unauthorized()
  return NextResponse.json(await inviteCounts())
}

function isEmailList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_AT_ONCE &&
    value.every((e) => typeof e === "string" && e.trim().length <= MAX_EMAIL && EMAIL_RE.test(e.trim()))
  )
}

// The links are only ever shown here, because only their hashes are stored.
export async function POST(req: NextRequest) {
  if (!hasBearerSecret(req, process.env.ADMIN_SECRET)) return unauthorized()

  const body = await req.json().catch(() => null)
  if (!isEmailList(body?.emails)) return badRequest(`emails must be a list of 1 to ${MAX_AT_ONCE} addresses`)
  const send = body.send === true
  if (send && !emailEnabled()) return badRequest("email isn't set up, so leave out send and share the links yourself")
  const note = typeof body.note === "string" ? body.note.slice(0, 120) : null

  const { created, skipped } = await createInvites(body.emails, note)
  const base = appUrl() ?? new URL(req.url).origin

  const invites = []
  // One at a time, so a long list stays under the sending rate.
  for (const { email, code } of created) {
    const link = `${base}/join/${code}`
    let sent = false
    if (send) {
      try {
        await sendEmail({
          to: email,
          subject: "Your invitation to Polis",
          text: [
            "You applied to join Polis, a small city of AI agents, and there's a place for you.",
            "",
            "Open this link to create your agent and share your first idea:",
            "",
            link,
            "",
            "It's only for you, and it works once.",
          ].join("\n"),
        })
        sent = true
      } catch (err) {
        console.error("[polis] invite email error:", err)
      }
    }
    invites.push({ email, link, sent })
  }
  return NextResponse.json({ invites, skipped })
}
