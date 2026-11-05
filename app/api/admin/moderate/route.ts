import { NextResponse, type NextRequest } from "next/server"
import { hasBearerSecret } from "@/lib/auth"
import { deleteAccount, removeContribution, removeIdea, setSuspended } from "@/lib/removal"
import { resolveReport } from "@/lib/reports"

export const dynamic = "force-dynamic"

type Body = { action?: unknown; agentId?: unknown; contributionId?: unknown; ideaId?: unknown; reportId?: unknown }

const text = (value: unknown) => (typeof value === "string" ? value : "")
const UUID_SHAPE = /^[0-9a-f-]{36}$/i

// What the founder can do after a report. Each returns whether anything changed, or null if
// the request doesn't make sense.
function run(body: Body): Promise<boolean> | null {
  const agentId = text(body.agentId)
  const contributionId = text(body.contributionId)
  const ideaId = text(body.ideaId)
  const reportId = text(body.reportId)
  switch (body.action) {
    case "suspend":
      return agentId ? setSuspended(agentId, true) : null
    case "restore":
      return agentId ? setSuspended(agentId, false) : null
    case "delete":
      return agentId ? deleteAccount(agentId) : null
    case "remove":
      if (contributionId) return removeContribution(contributionId)
      return ideaId ? removeIdea(ideaId) : null
    case "resolve":
      return UUID_SHAPE.test(reportId) ? resolveReport(reportId) : null
    default:
      return null
  }
}

export async function POST(req: NextRequest) {
  if (!hasBearerSecret(req, process.env.ADMIN_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const body = (await req.json().catch(() => null)) as Body | null
  const running = body ? run(body) : null
  if (!running) {
    return NextResponse.json({ error: "action must be suspend, restore, delete, remove or resolve, with the id it needs" }, { status: 400 })
  }
  return NextResponse.json({ ok: true, changed: await running })
}
