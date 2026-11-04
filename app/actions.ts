"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { after } from "next/server"
import {
  addOwnerWords,
  OwnerWordsError,
  shareIdea,
  type OwnerWordsRefusal,
  MAX_IDEAS_PER_DAY,
  MIN_IDEA_TEXT,
  MAX_OWNER_TEXT,
  MAX_OWNER_WORDS_PER_CONVERSATION,
} from "@/lib/conversations"
import { isAllowedName } from "@/lib/attribution"
import { currentMember, JoinError, joinWithInvite, type JoinRefusal, type JoinResult } from "@/lib/members"
import { isPlace } from "@/lib/places"
import { nudgeAgentGoal, ownsAgent } from "@/lib/queries"
import { welcomeReply } from "@/lib/simulation"
import { TRAIT_OPTIONS } from "@/lib/types"

// httpOnly cookie name that holds the owner token for a given agent. There is no
// login, so this cookie is the proof that this browser owns the citizen.
const ownerCookie = (agentId: string) => `polis-own-${agentId}`

const GOAL_MAX = 400
const MAX_NAME = 60
const MAX_INTERESTS = 200
const MAX_EMAIL = 254
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// values come back with a refusal: React clears a form when its action finishes, and
// nobody should lose what they wrote.
export type JoinState = {
  error?: string
  values?: { name: string; interests: string; idea: string; email: string }
}

const JOIN_MESSAGES: Record<JoinRefusal, string> = {
  invite: "This invite has already been used or isn't valid.",
  email_taken: "That email already has a citizen. Each person gets one.",
}

export async function joinAction(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const code = String(formData.get("code") ?? "")
  const name = String(formData.get("name") ?? "").trim()
  const interests = String(formData.get("interests") ?? "").trim()
  const idea = String(formData.get("idea") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim()
  const place = String(formData.get("place") ?? "")
  const traits = formData.getAll("traits").map(String)
  const refuse = (error: string): JoinState => ({ error, values: { name, interests, idea, email } })

  if (await currentMember()) return refuse("You already have a citizen here.")
  if (name.length < 2 || name.length > MAX_NAME) return refuse(`Give your agent a name of 2 to ${MAX_NAME} characters.`)
  if (!isAllowedName(name)) return refuse("Your agent's name can use letters, numbers, spaces, hyphens, apostrophes and periods.")
  // Only known trait values, so a hand-crafted POST can't store junk.
  if (traits.length < 3 || traits.length > 5 || !traits.every((t) => (TRAIT_OPTIONS as readonly string[]).includes(t))) {
    return refuse("Pick between 3 and 5 personality traits.")
  }
  if (interests.length < 3 || interests.length > MAX_INTERESTS) {
    return refuse(`Tell us what you're interested in (up to ${MAX_INTERESTS} characters).`)
  }
  if (idea.length < MIN_IDEA_TEXT || idea.length > MAX_OWNER_TEXT) {
    return refuse(`Your idea needs ${MIN_IDEA_TEXT} to ${MAX_OWNER_TEXT} characters.`)
  }
  if (!isPlace(place)) return refuse("Pick one of the city's places.")
  if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) return refuse("That email doesn't look right.")

  let joined: JoinResult
  try {
    joined = await joinWithInvite({ code, email, name, traits, interests, idea, place })
  } catch (err) {
    if (err instanceof JoinError) return refuse(JOIN_MESSAGES[err.reason])
    console.error("[polis] join error:", err)
    return refuse("Something went wrong. Please try again.")
  }

  const store = await cookies()
  store.set(ownerCookie(joined.id), joined.ownerToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })

  // After responding, so nobody waits on the model to join. If this fails, the regular
  // queue reaches the conversation later.
  after(() => welcomeReply(joined.conversationId).catch((err) => console.error("[polis] welcome error:", err)))

  revalidatePath("/")
  redirect(`/conversation/${joined.conversationId}`)
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
