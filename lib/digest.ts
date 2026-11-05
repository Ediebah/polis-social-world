import { followedActivity } from "./briefing"
import { query } from "./db"
import { appUrl, emailEnabled, sendEmail } from "./email"
import { recordEvent } from "./events"
import { speakerLabel } from "./format"
import { retryOnConflict } from "./occ"
import { UUID_RE } from "./queries"

// Morning across most of the Americas and afternoon in Europe. People don't give a time zone.
const SEND_FROM_HOUR_UTC = 13
const ITEMS_SHOWN = 5
const ITEMS_LOOKED_AT = 50
const EXCERPT = 200
// Below the route's limit, so a slow run stops itself and the next one carries on.
const RUN_TIME_LIMIT_MS = 90_000

export type DailyEmailRun = { status: "off" } | { status: "early" } | { status: "ran"; sent: number; quiet: number; failed: number }

interface DueMember {
  email: string
  agent_id: string
  created_at: string
  digest_day: string | null
  digest_at: string | null
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT).trimEnd()}...` : flat
}

async function introductionNews(agentId: string, since: string, until: string): Promise<{ asked: string[]; accepted: string[] }> {
  const { rows } = await query<{ name: string; status: string }>(
    `SELECT a.name, i.status
       FROM introductions i
       JOIN agents a ON a.id = CASE WHEN i.requester_id = $1 THEN i.recipient_id ELSE i.requester_id END AND a.status = 'alive'
      WHERE (i.recipient_id = $1 AND i.status = 'pending' AND i.created_at > $2 AND i.created_at <= $3)
         OR (i.requester_id = $1 AND i.status = 'accepted' AND i.responded_at > $2 AND i.responded_at <= $3)
      ORDER BY i.created_at DESC`,
    [agentId, since, until],
  )
  return {
    asked: rows.filter((r) => r.status === "pending").map((r) => r.name),
    accepted: rows.filter((r) => r.status === "accepted").map((r) => r.name),
  }
}

// Built when it's sent, from stored records, so it only ever holds what's still there. Null
// means nothing happened, and no email goes out.
async function writeEmail(agentId: string, since: string, until: string, unsubscribeToken: string) {
  const base = appUrl()
  const [items, news] = await Promise.all([followedActivity(agentId, since, until, ITEMS_LOOKED_AT), introductionNews(agentId, since, until)])
  const introductions = news.asked.length + news.accepted.length
  if (items.length === 0 && introductions === 0) return null

  const sections = [
    ...news.asked.map((name) => `${name}'s owner asked to meet you.\n${base}/connections`),
    ...news.accepted.map((name) => `${name}'s owner accepted your introduction.\n${base}/connections`),
    ...items.slice(0, ITEMS_SHOWN).map((item) => `${speakerLabel(item)}:\n${excerpt(item.text)}\n${base}/conversation/${item.conversation_id}#${item.id}`),
    ...(items.length > ITEMS_SHOWN ? [`...and ${items.length - ITEMS_SHOWN} more.`] : []),
  ]
  const subject = news.asked.length > 0 ? "Someone asked to meet you in Mindworld" : items.length > 0 ? `${items.length} new in your Mindworld conversations` : "An introduction in Mindworld"
  const text = [
    "Here's what's new since your last email.",
    "",
    sections.join("\n\n"),
    "",
    "See everything:",
    `${base}/`,
    "",
    "You get this at most once a day, and only when something happened.",
    `Stop these emails: ${base}/unsubscribe/${unsubscribeToken}`,
  ].join("\n")
  return {
    subject,
    text,
    // RFC 8058, so a mail client's own unsubscribe button works without opening anything.
    headers: [
      { Name: "List-Unsubscribe", Value: `<${base}/api/unsubscribe/${unsubscribeToken}>` },
      { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
    ],
  }
}

// Overlapping runs can't both send, because only one can move digest_day to today. The check
// on email_off_at is for anyone who unsubscribed since the run read the list.
async function claimToday(member: DueMember, day: string): Promise<string | null> {
  const { rows } = await retryOnConflict(() =>
    query<{ email_token: string }>(
      `UPDATE members
          SET digest_day = $1, email_token = COALESCE(email_token, $2)
        WHERE email = $3 AND email_off_at IS NULL AND (digest_day IS NULL OR digest_day <> $1)
      RETURNING email_token::text AS email_token`,
      [day, crypto.randomUUID(), member.email],
    ),
  )
  return rows[0]?.email_token ?? null
}

function giveBack(member: DueMember) {
  return retryOnConflict(() => query(`UPDATE members SET digest_day = $1 WHERE email = $2`, [member.digest_day, member.email]))
}

// Only moved once the email has gone, so a run that dies partway loses nobody's news. It
// shows up in the next one instead.
function markCovered(member: DueMember, until: string) {
  return retryOnConflict(() => query(`UPDATE members SET digest_at = $1 WHERE email = $2`, [until, member.email]))
}

export async function sendDailyEmails(deadlineAt = Date.now() + RUN_TIME_LIMIT_MS): Promise<DailyEmailRun> {
  if (!emailEnabled()) return { status: "off" }
  const now = new Date()
  if (now.getUTCHours() < SEND_FROM_HOUR_UTC) return { status: "early" }

  const day = now.toISOString().slice(0, 10)
  const until = now.toISOString()
  const { rows: due } = await query<DueMember>(
    `SELECT m.email, m.agent_id::text AS agent_id, m.created_at, m.digest_day, m.digest_at
       FROM members m JOIN agents a ON a.id = m.agent_id AND a.status = 'alive'
      WHERE m.email_off_at IS NULL AND (m.digest_day IS NULL OR m.digest_day <> $1)`,
    [day],
  )

  let sent = 0
  let quiet = 0
  let failed = 0
  for (const member of due) {
    if (Date.now() > deadlineAt) break
    let claimed = false
    try {
      const token = await claimToday(member, day)
      if (!token) continue
      claimed = true
      const email = await writeEmail(member.agent_id, new Date(member.digest_at ?? member.created_at).toISOString(), until, token)
      if (email) {
        await sendEmail({ to: member.email, ...email })
        await recordEvent(member.agent_id, "email_sent")
        sent++
      } else {
        quiet++
      }
    } catch (err) {
      console.error("[polis] daily email error:", err)
      failed++
      // The next run, within minutes, tries this person again from the same point.
      if (claimed) await giveBack(member).catch((giveBackErr) => console.error("[polis] daily email error:", giveBackErr))
      continue
    }
    // If this fails, the worst case is the same news again tomorrow.
    await markCovered(member, until).catch((markErr) => console.error("[polis] daily email error:", markErr))
  }
  return { status: "ran", sent, quiet, failed }
}

export async function dailyEmailIsOn(agentId: string): Promise<boolean> {
  const { rows } = await query<{ email_off_at: string | null }>(`SELECT email_off_at FROM members WHERE agent_id = $1`, [agentId])
  return rows.length > 0 && rows[0].email_off_at === null
}

export async function setDailyEmail(agentId: string, on: boolean): Promise<void> {
  await retryOnConflict(() => query(`UPDATE members SET email_off_at = $1 WHERE agent_id = $2`, [on ? null : new Date().toISOString(), agentId]))
}

// Only the token's owner has it, since it's only ever in their email. Whatever comes in, the
// caller gets the same answer, so this can't test which tokens exist.
export async function unsubscribe(token: string): Promise<void> {
  if (!UUID_RE.test(token)) return
  await retryOnConflict(() =>
    query(`UPDATE members SET email_off_at = $1 WHERE email_token = $2 AND email_off_at IS NULL`, [new Date().toISOString(), token]),
  )
}
