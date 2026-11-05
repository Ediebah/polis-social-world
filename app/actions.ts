"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { after } from "next/server"
import {
  addOwnerWords,
  guideAgent,
  isGuideMove,
  OwnerWordsError,
  setConversationFollow,
  setPlaceFollow,
  shareIdea,
  updateInterests,
  type OwnerWordsRefusal,
  MAX_IDEAS_PER_DAY,
  MIN_IDEA_TEXT,
  MAX_OWNER_TEXT,
  MAX_OWNER_WORDS_PER_CONVERSATION,
} from "@/lib/conversations"
import {
  askToMeet,
  IntroError,
  MAX_ASKS_PER_DAY,
  MAX_CONTACT,
  MIN_CONTACT,
  respondToIntroduction,
  type IntroRefusal,
} from "@/lib/introductions"
import { isAllowedName } from "@/lib/attribution"
import { setDailyEmail, unsubscribe } from "@/lib/digest"
import { recordEvent } from "@/lib/events"
import { redeemLoginLink, sendLoginLink } from "@/lib/login"
import { currentMember, JoinError, joinWithInvite, type JoinResult } from "@/lib/members"
import { ownerCookie, OWNER_COOKIE_OPTIONS, OWN_PREFIX } from "@/lib/owner-cookies"
import { isPlace } from "@/lib/places"
import { ownsAgent } from "@/lib/queries"
import { deleteAccount, setAgentPaused, withdrawIdea, withdrawWords } from "@/lib/removal"
import { isReportReason, MAX_REPORT_NOTE } from "@/lib/report-reasons"
import { fileReport, notifyFounder, ReportError, type ReportRefusal } from "@/lib/reports"
import { welcomeReply } from "@/lib/simulation"
import { TRAIT_OPTIONS } from "@/lib/types"

const MAX_NAME = 60
const MAX_INTERESTS = 200
const MAX_EMAIL = 254
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// values come back with a refusal: React clears a form when its action finishes, and
// nobody should lose what they wrote.
export type JoinState = {
  error?: string
  values?: { name: string; interests: string; idea: string }
}

export async function joinAction(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const code = String(formData.get("code") ?? "")
  const name = String(formData.get("name") ?? "").trim()
  const interests = String(formData.get("interests") ?? "").trim()
  const idea = String(formData.get("idea") ?? "").trim()
  const place = String(formData.get("place") ?? "")
  const traits = formData.getAll("traits").map(String)
  const refuse = (error: string): JoinState => ({ error, values: { name, interests, idea } })

  if (await currentMember()) return refuse("You already have a citizen here.")
  if (name.length < 2 || name.length > MAX_NAME) return refuse(`Give your agent a name of 2 to ${MAX_NAME} characters.`)
  if (!isAllowedName(name)) return refuse("Your agent's name can use letters from one alphabet, numbers, spaces, hyphens, apostrophes and periods.")
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

  let joined: JoinResult
  try {
    joined = await joinWithInvite({ code, name, traits, interests, idea, place })
  } catch (err) {
    if (err instanceof JoinError) {
      return refuse(
        err.reason === "name" ? "That name is taken. Pick another for your agent." : "This invite can't be used. Ask whoever sent it for a new one.",
      )
    }
    console.error("[polis] join error:", err)
    return refuse("Something went wrong. Please try again.")
  }

  await recordEvent(joined.id, "joined")
  const store = await cookies()
  store.set(ownerCookie(joined.id), joined.ownerToken, OWNER_COOKIE_OPTIONS)

  // After responding, so nobody waits on the model to join. If this fails, the regular
  // queue reaches the conversation later.
  after(() => welcomeReply(joined.conversationId).catch((err) => console.error("[polis] welcome error:", err)))

  revalidatePath("/")
  redirect(`/conversation/${joined.conversationId}`)
}

export type LoginState = { sent?: boolean; error?: string }

// Only this browser: the same link in your email brings you back.
export async function signOutAction(): Promise<void> {
  const store = await cookies()
  for (const { name } of store.getAll()) {
    if (name.startsWith(OWN_PREFIX)) store.delete(name)
  }
  redirect("/login")
}

export async function requestLoginLinkAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim()
  if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) return { error: "That email doesn't look right." }

  // After responding, so the answer and how long it takes are the same for a member and
  // a stranger.
  after(() => sendLoginLink(email).catch((err) => console.error("[polis] login link error:", err)))
  return { sent: true }
}

export async function redeemLoginLinkAction(formData: FormData): Promise<void> {
  const citizen = await redeemLoginLink(String(formData.get("token") ?? ""))
  if (!citizen) redirect("/login?expired=1")

  const store = await cookies()
  for (const { name } of store.getAll()) {
    if (name.startsWith(OWN_PREFIX)) store.delete(name)
  }
  store.set(ownerCookie(citizen.id), citizen.ownerToken, OWNER_COOKIE_OPTIONS)
  redirect("/")
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
  await recordEvent(agentId, "words")
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
  await recordEvent(agentId, "idea")
  revalidatePath("/me")
  revalidatePath("/explore")
  revalidatePath("/")
  return { ok: true }
}

// The buttons below act as whichever citizen this browser owns, never one named in the form.

export type IntroductionFormState = { error?: string; done?: "asked" | "connected"; contact?: string }

const INTRO_MESSAGES: Record<IntroRefusal, string> = {
  self: "That's your own agent.",
  no_one: "There's nobody behind this agent to meet.",
  contact: `Add how they can reach you, in ${MIN_CONTACT} to ${MAX_CONTACT} characters.`,
  limit: `You've asked the most you can for today (${MAX_ASKS_PER_DAY}).`,
  slow_down: "Please wait a moment before asking again.",
  already: "You've already asked.",
  gone: "This request is no longer open.",
}

function introFailure(err: unknown): string {
  if (err instanceof IntroError) return INTRO_MESSAGES[err.reason]
  console.error("[polis] introduction error:", err)
  return "Something went wrong. Please try again."
}

function revalidateConnections() {
  revalidatePath("/connections")
  revalidatePath("/")
}

export async function askToMeetAction(_prev: IntroductionFormState, formData: FormData): Promise<IntroductionFormState> {
  const contact = String(formData.get("contact") ?? "")
  const member = await currentMember()
  if (!member) return { error: "Sign in to ask.", contact }

  try {
    const done = await askToMeet(
      member.id,
      String(formData.get("agentId") ?? ""),
      contact,
      String(formData.get("conversationId") ?? "") || undefined,
    )
    await recordEvent(member.id, "ask_to_meet")
    if (done === "connected") await recordEvent(member.id, "intro_connected")
    revalidateConnections()
    return { done }
  } catch (err) {
    return { error: introFailure(err), contact }
  }
}

export async function acceptIntroductionAction(_prev: IntroductionFormState, formData: FormData): Promise<IntroductionFormState> {
  const contact = String(formData.get("contact") ?? "")
  const member = await currentMember()
  if (!member) return { error: "Sign in to answer.", contact }

  try {
    await respondToIntroduction(member.id, String(formData.get("agentId") ?? ""), true, contact)
    await recordEvent(member.id, "intro_connected")
    revalidateConnections()
    return { done: "connected" }
  } catch (err) {
    return { error: introFailure(err), contact }
  }
}

export async function declineIntroductionAction(formData: FormData): Promise<void> {
  const member = await currentMember()
  if (!member) return

  await respondToIntroduction(member.id, String(formData.get("agentId") ?? ""), false).catch((err) => {
    if (!(err instanceof IntroError)) console.error("[polis] introduction error:", err)
  })
  revalidateConnections()
}

export async function guideAction(formData: FormData): Promise<void> {
  const member = await currentMember()
  const conversationId = String(formData.get("conversationId") ?? "")
  const move = String(formData.get("move") ?? "")
  if (!member || !isGuideMove(move)) return

  if (await guideAgent(member.id, conversationId, move)) await recordEvent(member.id, "guide")
  revalidatePath(`/conversation/${conversationId}`)
}

export async function setConversationFollowAction(formData: FormData): Promise<void> {
  const member = await currentMember()
  if (!member) return

  const conversationId = String(formData.get("conversationId") ?? "")
  await setConversationFollow(member.id, conversationId, formData.get("follow") === "1")
  revalidatePath(`/conversation/${conversationId}`)
  revalidateConnections()
}

export async function setPlaceFollowAction(formData: FormData): Promise<void> {
  const member = await currentMember()
  const place = String(formData.get("place") ?? "")
  if (!member || !isPlace(place)) return

  await setPlaceFollow(member.id, place, formData.get("follow") === "1")
  revalidatePath("/explore")
  revalidatePath("/")
}

export type InterestsState = { error?: string; ok?: boolean; interests?: string }

export async function updateInterestsAction(_prev: InterestsState, formData: FormData): Promise<InterestsState> {
  const raw = String(formData.get("interests") ?? "")
  const member = await currentMember()
  if (!member) return { error: "Sign in to change this.", interests: raw }

  const interests = raw.trim()
  if (interests.length < 3 || interests.length > MAX_INTERESTS) {
    return { error: `Tell us what you're interested in (up to ${MAX_INTERESTS} characters).`, interests: raw }
  }
  try {
    await updateInterests(member.id, interests)
  } catch (err) {
    console.error("[polis] interests error:", err)
    return { error: "Something went wrong. Please try again.", interests: raw }
  }
  revalidatePath("/me")
  return { ok: true }
}

// Removing your own things. Each acts as whoever is signed in, so nobody can reach anyone else's.

export async function withdrawIdeaAction(formData: FormData): Promise<void> {
  const member = await currentMember()
  if (!member) return

  if (await withdrawIdea(member.id, String(formData.get("ideaId") ?? ""))) await recordEvent(member.id, "withdrew")
  revalidatePath("/me")
  revalidatePath("/explore")
  revalidatePath("/")
}

export async function withdrawWordsAction(formData: FormData): Promise<void> {
  const member = await currentMember()
  if (!member) return

  const conversationId = String(formData.get("conversationId") ?? "")
  if (await withdrawWords(member.id, String(formData.get("contributionId") ?? ""))) await recordEvent(member.id, "withdrew")
  revalidatePath(`/conversation/${conversationId}`)
  revalidatePath("/")
}

export async function setPausedAction(formData: FormData): Promise<void> {
  const member = await currentMember()
  if (!member) return

  await setAgentPaused(member.id, formData.get("paused") === "1")
  revalidatePath("/me")
  revalidatePath("/")
}

export async function setDailyEmailAction(formData: FormData): Promise<void> {
  const member = await currentMember()
  if (!member) return

  await setDailyEmail(member.id, formData.get("on") === "1")
  revalidatePath("/me")
}

// Comes from the link in the email, so there may be nobody signed in.
export async function unsubscribeAction(formData: FormData): Promise<void> {
  await unsubscribe(String(formData.get("token") ?? "")).catch((err) => console.error("[polis] unsubscribe error:", err))
  redirect("/unsubscribe/done")
}

export type DeleteAccountState = { error?: string }

export async function deleteAccountAction(_prev: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  const member = await currentMember()
  if (!member) return { error: "Sign in to do this." }

  // Typing the name makes it hard to do by accident, since it can't be undone.
  if (String(formData.get("confirm") ?? "").trim() !== member.name) {
    return { error: `Type ${member.name} exactly to confirm.` }
  }
  try {
    await deleteAccount(member.id)
  } catch (err) {
    console.error("[polis] delete account error:", err)
    return { error: "Something went wrong, and nothing was deleted. Please try again." }
  }
  const store = await cookies()
  for (const { name } of store.getAll()) {
    if (name.startsWith(OWN_PREFIX)) store.delete(name)
  }
  redirect("/join?deleted=1")
}

export type ReportState = { error?: string; ok?: boolean; note?: string }

const REPORT_MESSAGES: Record<ReportRefusal, string> = {
  target: "This can't be reported.",
  limit: "You've sent the most reports you can for today.",
}

export async function reportAction(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const note = String(formData.get("note") ?? "")
  const reason = String(formData.get("reason") ?? "")
  const member = await currentMember()
  if (!member) return { error: "Sign in to report this.", note }
  if (!isReportReason(reason)) return { error: "Pick a reason.", note }
  if (note.length > MAX_REPORT_NOTE) return { error: `That's too long (max ${MAX_REPORT_NOTE} characters).`, note }

  try {
    const { id } = await fileReport(
      member.id,
      {
        contributionId: String(formData.get("contributionId") ?? ""),
        ideaId: String(formData.get("ideaId") ?? ""),
        agentId: String(formData.get("agentId") ?? ""),
      },
      reason,
      note.trim(),
    )
    await recordEvent(member.id, "reported")
    // After responding, so nobody waits on the email. The report is stored whatever happens.
    after(() => notifyFounder(id).catch((err) => console.error("[polis] report email error:", err)))
    return { ok: true }
  } catch (err) {
    if (err instanceof ReportError) return { error: REPORT_MESSAGES[err.reason], note }
    console.error("[polis] report error:", err)
    return { error: "Something went wrong. Please try again.", note }
  }
}
