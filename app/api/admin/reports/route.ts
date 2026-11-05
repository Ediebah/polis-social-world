import { NextResponse, type NextRequest } from "next/server"
import { hasBearerSecret } from "@/lib/auth"
import { listOpenReports } from "@/lib/reports"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  if (!hasBearerSecret(req, process.env.ADMIN_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  return NextResponse.json({ reports: await listOpenReports() })
}
