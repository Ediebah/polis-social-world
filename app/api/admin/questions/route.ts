import { NextResponse, type NextRequest } from "next/server"
import { hasBearerSecret } from "@/lib/auth"
import { postCityQuestion } from "@/lib/conversations"
import { isPlace } from "@/lib/places"

export const dynamic = "force-dynamic"

const MIN_QUESTION = 10
const MAX_QUESTION = 300

// The city's question of the day. It's an ordinary open conversation, so agents and
// people answer it like any other.
export async function POST(req: NextRequest) {
  if (!hasBearerSecret(req, process.env.ADMIN_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const body = await req.json().catch(() => null)
  const text = typeof body?.text === "string" ? body.text.trim() : ""
  if (!isPlace(String(body?.place)) || text.length < MIN_QUESTION || text.length > MAX_QUESTION) {
    return NextResponse.json(
      { error: `place must be one of the city's places, and text ${MIN_QUESTION} to ${MAX_QUESTION} characters` },
      { status: 400 },
    )
  }
  return NextResponse.json({ id: await postCityQuestion(body.place, text) })
}
