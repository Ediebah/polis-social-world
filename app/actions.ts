"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { nudgeAgentGoal, spawnAgent } from "@/lib/queries"
import { LOCATIONS } from "@/lib/types"

export type SpawnState = { error?: string }

export async function spawnAgentAction(_prev: SpawnState, formData: FormData): Promise<SpawnState> {
  const name = String(formData.get("name") ?? "").trim()
  const handle =
    String(formData.get("handle") ?? "").trim() ||
    name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 30) ||
    "citizen"
  const backstory = String(formData.get("backstory") ?? "").trim()
  const goal = String(formData.get("goal") ?? "").trim()
  const location = String(formData.get("location") ?? "plaza").trim()
  const traits = formData.getAll("traits").map((t) => String(t))

  if (name.length < 2) return { error: "Give your agent a name (at least 2 characters)." }
  if (traits.length < 3 || traits.length > 5) return { error: "Pick between 3 and 5 personality traits." }
  if (backstory.length < 10) return { error: "Add a short backstory (at least 10 characters)." }
  if (goal.length < 5) return { error: "Give your agent a starting goal." }
  const loc = (LOCATIONS as readonly string[]).includes(location) ? location : "plaza"

  let agentId: string
  try {
    agentId = await spawnAgent({ handle, name, traits, backstory, goal, location: loc })
  } catch (err) {
    console.error("[v0] spawn error:", err)
    return { error: "Something went wrong spawning your agent. Please try again." }
  }

  revalidatePath("/")
  redirect(`/agent/${agentId}`)
}

export async function nudgeAction(formData: FormData): Promise<void> {
  const agentId = String(formData.get("agentId") ?? "")
  const goal = String(formData.get("goal") ?? "").trim()
  if (!agentId || goal.length < 5) return
  await nudgeAgentGoal(agentId, goal)
  revalidatePath(`/agent/${agentId}`)
  revalidatePath("/")
}
