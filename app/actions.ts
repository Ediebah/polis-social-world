"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { nudgeAgentGoal, ownsAgent, spawnAgent } from "@/lib/queries"
import { LOCATIONS, TRAIT_OPTIONS } from "@/lib/types"

export type SpawnState = { error?: string }

// httpOnly cookie name that holds the owner token for a given agent. There is no
// login, so this cookie is the proof that this browser spawned the citizen.
const ownerCookie = (agentId: string) => `polis-own-${agentId}`

const GOAL_MAX = 400

export async function spawnAgentAction(_prev: SpawnState, formData: FormData): Promise<SpawnState> {
  const name = String(formData.get("name") ?? "").trim()
  const handle = (
    String(formData.get("handle") ?? "").trim() ||
    name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 30) ||
    "citizen"
  ).slice(0, 30)
  const backstory = String(formData.get("backstory") ?? "").trim()
  const goal = String(formData.get("goal") ?? "").trim()
  const location = String(formData.get("location") ?? "plaza").trim()
  // Only accept known trait values, so a hand-crafted POST can't store junk.
  const traits = formData
    .getAll("traits")
    .map((t) => String(t))
    .filter((t) => (TRAIT_OPTIONS as readonly string[]).includes(t))

  if (name.length < 2) return { error: "Give your agent a name (at least 2 characters)." }
  if (name.length > 60) return { error: "That name is too long (max 60 characters)." }
  if (traits.length < 3 || traits.length > 5) return { error: "Pick between 3 and 5 personality traits." }
  if (backstory.length < 10) return { error: "Add a short backstory (at least 10 characters)." }
  if (backstory.length > 1000) return { error: "That backstory is too long (max 1000 characters)." }
  if (goal.length < 5) return { error: "Give your agent a starting goal." }
  if (goal.length > GOAL_MAX) return { error: `That goal is too long (max ${GOAL_MAX} characters).` }
  const loc = (LOCATIONS as readonly string[]).includes(location) ? location : "plaza"

  let agentId: string
  let ownerToken: string
  try {
    const res = await spawnAgent({ handle, name, traits, backstory, goal, location: loc })
    agentId = res.id
    ownerToken = res.ownerToken
  } catch (err) {
    console.error("[v0] spawn error:", err)
    return { error: "Something went wrong spawning your agent. Please try again." }
  }

  // Remember ownership server-side so only this browser can nudge the citizen.
  const store = await cookies()
  store.set(ownerCookie(agentId), ownerToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })

  revalidatePath("/")
  // ?me=1 lets the agent page remember this as "your" citizen (no login).
  redirect(`/agent/${agentId}?me=1`)
}

export async function nudgeAction(formData: FormData): Promise<void> {
  const agentId = String(formData.get("agentId") ?? "")
  const goal = String(formData.get("goal") ?? "").trim()
  if (!agentId || goal.length < 5 || goal.length > GOAL_MAX) return

  // Only the spawner (holding the matching owner token) may nudge this agent.
  const token = (await cookies()).get(ownerCookie(agentId))?.value
  if (!(await ownsAgent(agentId, token))) return

  await nudgeAgentGoal(agentId, goal)
  revalidatePath(`/agent/${agentId}`)
  revalidatePath("/")
}
