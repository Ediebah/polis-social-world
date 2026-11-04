// Each spawn leaves an httpOnly polis-own-<agentId> cookie holding the owner token,
// since there is no login. These pairs still have to be checked against the database.
const OWN_PREFIX = "polis-own-"

export function ownerPairs(cookies: { name: string; value: string }[]): { id: string; token: string }[] {
  return cookies
    .filter((c) => c.name.startsWith(OWN_PREFIX) && c.value)
    .map((c) => ({ id: c.name.slice(OWN_PREFIX.length), token: c.value }))
}
