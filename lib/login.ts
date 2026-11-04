import { createHash, randomBytes } from "node:crypto"
import { query, transaction } from "./db"
import { appUrl, emailEnabled, sendEmail } from "./email"
import { normalizeEmail } from "./members"
import { retryOnConflict } from "./occ"

export const LOGIN_LINK_MINUTES = 30
export const MAX_LINKS_PER_HOUR = 3

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

// The counter is claimed with a single update, so simultaneous requests can't get past
// the limit. Anyone can ask for a link to any address, so this is what stops the form
// being used to fill a member's inbox.
export async function sendLoginLink(rawEmail: string): Promise<void> {
  if (!emailEnabled()) {
    console.error("[polis] login link not sent: email isn't configured")
    return
  }
  const email = normalizeEmail(rawEmail)
  const token = randomBytes(32).toString("base64url")

  const created = await retryOnConflict(() =>
    transaction(async (client) => {
      const now = new Date()
      const hour = now.toISOString().slice(0, 13)
      const claim = await client.query(
        `UPDATE members
            SET links_this_hour = CASE WHEN link_hour = $1 THEN links_this_hour + 1 ELSE 1 END, link_hour = $1
          WHERE email = $2 AND (link_hour IS NULL OR link_hour <> $1 OR links_this_hour < $3)`,
        [hour, email, MAX_LINKS_PER_HOUR],
      )
      if (claim.rowCount !== 1) return false

      const citizen = await client.query<{ id: string }>(
        `SELECT a.id FROM members m JOIN agents a ON a.id = m.agent_id WHERE m.email = $1 AND a.status = 'alive'`,
        [email],
      )
      if (citizen.rows.length === 0) return false

      await client.query(
        `INSERT INTO login_links (token_hash, agent_id, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
        [
          hashToken(token),
          citizen.rows[0].id,
          now.toISOString(),
          new Date(now.getTime() + LOGIN_LINK_MINUTES * 60_000).toISOString(),
        ],
      )
      return true
    }),
  )
  if (!created) return

  await sendEmail({
    to: email,
    subject: "Your sign-in link for Polis",
    text: [
      "Open this link to sign in to Polis:",
      "",
      `${appUrl()}/login/${token}`,
      "",
      `It works once and expires in ${LOGIN_LINK_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`,
    ].join("\n"),
  })
}

// Doesn't use the link up, because mail scanners open links before people do.
export async function peekLoginLink(token: string): Promise<{ name: string } | null> {
  const { rows } = await query<{ name: string }>(
    `SELECT a.name FROM login_links l JOIN agents a ON a.id = l.agent_id
      WHERE l.token_hash = $1 AND l.used_at IS NULL AND l.expires_at > $2 AND a.status = 'alive'`,
    [hashToken(token), new Date().toISOString()],
  )
  return rows[0] ?? null
}

export function redeemLoginLink(token: string): Promise<{ id: string; ownerToken: string; name: string } | null> {
  const tokenHash = hashToken(token)
  return retryOnConflict(() =>
    transaction(async (client) => {
      const claim = await client.query(
        `UPDATE login_links SET used_at = $1 WHERE token_hash = $2 AND used_at IS NULL AND expires_at > $1`,
        [new Date().toISOString(), tokenHash],
      )
      if (claim.rowCount !== 1) return null

      const { rows } = await client.query<{ id: string; owner_token: string; name: string }>(
        `SELECT a.id::text AS id, a.owner_token::text AS owner_token, a.name
           FROM login_links l JOIN agents a ON a.id = l.agent_id
          WHERE l.token_hash = $1 AND a.status = 'alive'`,
        [tokenHash],
      )
      if (rows.length === 0) return null
      return { id: rows[0].id, ownerToken: rows[0].owner_token, name: rows[0].name }
    }),
  )
}
