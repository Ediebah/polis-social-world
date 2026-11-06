// Stands in for lib/db.ts so tests run the app's real SQL against an in-memory
// Postgres (PGlite). DSQL-specific syntax is translated, and failNext() recreates
// DSQL's optimistic-concurrency failures, which PGlite never raises on its own.
import { PGlite } from "@electric-sql/pglite"

let pg: PGlite | null = null
const faults: { pattern: RegExp; code: string; remaining: number }[] = []

export async function startDb() {
  pg = new PGlite()
}

export function failNext(pattern: RegExp, code = "40001", times = 1) {
  faults.push({ pattern, code, remaining: times })
}

export function clearFaults() {
  faults.length = 0
}

function raiseFault(text: string) {
  const fault = faults.find((f) => f.remaining > 0 && f.pattern.test(text))
  if (!fault) return
  fault.remaining--
  throw Object.assign(new Error(`injected ${fault.code}`), { code: fault.code })
}

export async function query(text: string, params?: unknown[]) {
  raiseFault(text)
  if (!pg) throw new Error("test database not started")
  const res = await pg.query(text.replace("CREATE INDEX ASYNC", "CREATE INDEX"), params as never[])
  const rows = res.rows as Record<string, unknown>[]
  return { rows, rowCount: res.affectedRows || rows.length }
}

const client = { query }

export async function withConnection<T>(fn: (c: typeof client) => Promise<T>): Promise<T> {
  return fn(client)
}

export async function transaction<T>(fn: (c: typeof client) => Promise<T>): Promise<T> {
  await query("BEGIN")
  try {
    const result = await fn(client)
    await query("COMMIT")
    return result
  } catch (err) {
    await query("ROLLBACK")
    throw err
  }
}
