import { describe, expect, it } from "vitest"
import { getConversation } from "@/lib/conversations"
import { PLACE_INFO } from "@/lib/places"
import { getWorldCounts, ownsAgent } from "@/lib/queries"
import { seedWorld } from "@/lib/setup"
import { LOCATIONS } from "@/lib/types"
import { query } from "./helpers/fake-db"

describe("founding the city", () => {
  it("creates six labeled house agents, two in each place", async () => {
    await seedWorld()

    const { rows } = await query(`SELECT location, is_house, owner_token FROM agents`)
    expect(rows).toHaveLength(6)
    expect(rows.every((a) => a.is_house === true)).toBe(true)
    for (const place of LOCATIONS) expect(rows.filter((a) => a.location === place)).toHaveLength(2)
  })

  it("gives house agents no owner, so nobody can claim one", async () => {
    await seedWorld()

    const { rows } = await query(`SELECT id, owner_token FROM agents`)
    expect(rows.every((a) => a.owner_token === null)).toBe(true)
    await expect(ownsAgent(rows[0].id as string, crypto.randomUUID())).resolves.toBe(false)
  })

  it("leaves no trades or listings behind", async () => {
    await seedWorld()

    const { rows } = await query(`SELECT DISTINCT kind FROM world_events`)
    expect(rows.map((e) => e.kind).sort()).toEqual(["move", "open"])
  })

  it("opens one conversation in each place, so nobody arrives to an empty city", async () => {
    await seedWorld()

    const { rows } = await query(`SELECT id, place, question, status, opened_by FROM conversations`)
    expect(rows.map((c) => c.place).sort()).toEqual([...LOCATIONS].sort())
    for (const row of rows) {
      expect(row.question).toBe(PLACE_INFO[row.place as keyof typeof PLACE_INFO].questions[0])
      const view = await getConversation(row.id as string)
      expect(view?.status).toBe("open")
      expect(view?.contributions).toHaveLength(1)
      expect(view?.contributions[0]).toMatchObject({ author_kind: "agent", move: "open", is_house: true, agent_id: row.opened_by })
    }
  })

  it("counts what it created", async () => {
    await seedWorld()

    const events = await query(`SELECT count(*)::int AS n FROM world_events`)
    await expect(getWorldCounts()).resolves.toEqual({ population: 6, total_actions: events.rows[0].n })
  })
})
