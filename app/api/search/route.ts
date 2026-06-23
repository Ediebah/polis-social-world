// app/api/search/route.ts
import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") ?? "").trim()
  if (q.length < 1) return NextResponse.json({ results: [] })

  try {
    const { rows } = await query<{ id: string; name: string; location: string }>(
      `SELECT id, name, location
         FROM agents
        WHERE status = 'alive' AND LOWER(name) LIKE LOWER($1)
        ORDER BY name
        LIMIT 8`,
      [`%${q}%`],
    )
    return NextResponse.json({ results: rows })
  } catch (err) {
    console.error("[polis] search error:", err)
    return NextResponse.json({ results: [] })
  }
}