// lib/me.ts
// Remembers "your" citizens in the browser, since there is no login. Appended on
// spawn, read by the nav. Safe to call anywhere (guards against SSR / disabled storage).
export type MyCitizen = { id: string; name: string }

// Legacy single-citizen key (pre multi-citizen). Migrated into LIST_KEY on first read.
const LEGACY_KEY = "polis:my-citizen"
const LIST_KEY = "polis:my-citizens"
const MAX = 20

// Read the stored list (oldest-first, most-recent-last), migrating any legacy
// single value on first access. Returns [] if storage is unavailable / empty.
function readList(): MyCitizen[] {
  try {
    const raw = localStorage.getItem(LIST_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as MyCitizen[]) : []
    }
    // Migrate a pre-existing single citizen into the list (most-recent-last).
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const c = JSON.parse(legacy) as MyCitizen
      const migrated = c && c.id ? [c] : []
      try {
        localStorage.setItem(LIST_KEY, JSON.stringify(migrated))
      } catch {
        // write failed — still return what we parsed
      }
      return migrated
    }
    return []
  } catch {
    return []
  }
}

// Remember a citizen: append it (dedupe by id, most-recent-last), capped at MAX.
export function addMyCitizen(c: MyCitizen) {
  try {
    const list = readList().filter((x) => x.id !== c.id)
    list.push(c)
    localStorage.setItem(LIST_KEY, JSON.stringify(list.slice(-MAX)))
  } catch {
    // storage unavailable — ignore
  }
}

// All remembered citizens, newest first (empty if none).
export function getMyCitizens(): MyCitizen[] {
  return readList().reverse()
}

// The most recently remembered citizen, or null. Kept for backward compatibility.
export function getMyCitizen(): MyCitizen | null {
  const list = readList()
  return list.length ? list[list.length - 1] : null
}
