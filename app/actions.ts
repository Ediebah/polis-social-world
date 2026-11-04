"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  addOwnerWords,
  OwnerWordsError,
  shareIdea,
  type OwnerWordsRefusal,
  MAX_IDEAS_PER_DAY,
  MAX_OWNER_TEXT,
  MAX_OWNER_WORDS_PER_CONVERSATION,
} from "@/lib/conversations"
import { nudgeAgentGoal, ownsAgent, spawnAgent, SpawnLimitError } from "@/lib/queries"
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
  const location = String(formData.get("location") ?? "commons").trim()
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
  const loc = (LOCATIONS as readonly string[]).includes(location) ? location : "commons"

  let agentId: string
  let ownerToken: string
  try {
    const res = await spawnAgent({ handle, name, traits, backstory, goal, location: loc })
    agentId = res.id
    ownerToken = res.ownerToken
  } catch (err) {
    if (err instanceof SpawnLimitError) {
      return { error: "The city has welcomed all the new citizens it can for today. Please try again tomorrow." }
    }
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

// text and place come back with a refusal: React clears a form when its action finishes,
// and nobody should lose what they wrote.
export type OwnerWordsState = { error?: string; ok?: boolean; text?: string; place?: string }

const OWNER_WORDS_MESSAGES: Record<OwnerWordsRefusal, string> = {
  too_short: "That's too short to post.",
  too_long: `That's too long (max ${MAX_OWNER_TEXT} characters).`,
  closed: "This conversation has closed.",
  limit: `You've posted the most you can here (${MAX_OWNER_WORDS_PER_CONVERSATION} times).`,
  idea_limit: `You've shared the most ideas you can for today (${MAX_IDEAS_PER_DAY}).`,
  slow_down: "Please wait a moment before posting again.",
  bad_place: "Pick one of the city's places.",
}

function ownerWordsFailure(err: unknown): string {
  if (err instanceof OwnerWordsError) return OWNER_WORDS_MESSAGES[err.reason]
  console.error("[polis] owner words error:", err)
  return "Something went wrong. Please try again."
}

export async function addWordsAction(_prev: OwnerWordsState, formData: FormData): Promise<OwnerWordsState> {
  const agentId = String(formData.get("agentId") ?? "")
  const conversationId = String(formData.get("conversationId") ?? "")
  const text = String(formData.get("text") ?? "")

  // Words go up under this citizen's owner, so only that owner may post them.
  const token = (await cookies()).get(ownerCookie(agentId))?.value
  if (!(await ownsAgent(agentId, token))) return { error: "Only this citizen's owner can post here.", text }

  try {
    await addOwnerWords(agentId, conversationId, text)
  } catch (err) {
    return { error: ownerWordsFailure(err), text }
  }
  revalidatePath(`/conversation/${conversationId}`)
  revalidatePath("/")
  return { ok: true }
}

export async function shareIdeaAction(_prev: OwnerWordsState, formData: FormData): Promise<OwnerWordsState> {
  const agentId = String(formData.get("agentId") ?? "")
  const place = String(formData.get("place") ?? "")
  const text = String(formData.get("text") ?? "")

  const token = (await cookies()).get(ownerCookie(agentId))?.value
  if (!(await ownsAgent(agentId, token))) return { error: "Only this citizen's owner can share an idea.", text, place }

  try {
    await shareIdea(agentId, text, place)
  } catch (err) {
    return { error: ownerWordsFailure(err), text, place }
  }
  revalidatePath(`/agent/${agentId}`)
  revalidatePath("/")
  return { ok: true }
}
