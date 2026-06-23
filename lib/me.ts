// lib/me.ts
// Remembers "your" citizen in the browser, since there is no login. Set on spawn,
// read by the nav. Safe to call anywhere (guards against SSR / disabled storage).
export type MyCitizen = { id: string; name: string }

const KEY = "polis:my-citizen"

export function setMyCitizen(c: MyCitizen) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    // storage unavailable — ignore
  }
}

export function getMyCitizen(): MyCitizen | null {
  try {
    const v = localStorage.getItem(KEY)
    return v ? (JSON.parse(v) as MyCitizen) : null
  } catch {
    return null
  }
}