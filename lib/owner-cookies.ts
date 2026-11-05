// Joining or using a sign-in link leaves an httpOnly polis-own-<agentId> cookie holding
// the owner token. These pairs still have to be checked against the database.
export const OWN_PREFIX = "polis-own-"

export const ownerCookie = (agentId: string) => `${OWN_PREFIX}${agentId}`

export const OWNER_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const

export function ownerPairs(cookies: { name: string; value: string }[]): { id: string; token: string }[] {
  return cookies
    .filter((c) => c.name.startsWith(OWN_PREFIX) && c.value)
    .map((c) => ({ id: c.name.slice(OWN_PREFIX.length), token: c.value }))
}
