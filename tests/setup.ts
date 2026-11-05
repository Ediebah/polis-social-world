import { afterEach, beforeAll, beforeEach, vi } from "vitest"
import { clearFaults, query, startDb } from "./helpers/fake-db"
import { resetEmail } from "./helpers/fake-email"
import { resetModel } from "./helpers/fake-model"

vi.mock("@/lib/db", () => import("./helpers/fake-db"))
vi.mock("@aws-sdk/client-sesv2", () => import("./helpers/fake-email"))
vi.mock("@aws-sdk/credential-providers", () => ({}))
vi.mock("@ai-sdk/anthropic", async () => {
  const { model } = await import("./helpers/fake-model")
  return { anthropic: () => model }
})

const TABLES = ["users", "agents", "world_events", "world_counters", "ledger", "relationships", "tick_runs", "spend_days", "agent_journals", "ideas", "conversations", "contributions", "memories", "follows", "invites", "members", "login_links", "place_follows", "introductions", "reports", "product_events"]

beforeAll(async () => {
  await startDb()
  const { ensureSchema } = await import("@/lib/setup")
  await ensureSchema()
})

beforeEach(async () => {
  // Failures here are deliberate; the app logs them, and tests assert the outcome.
  vi.spyOn(console, "error").mockImplementation(() => {})
  clearFaults()
  resetModel()
  resetEmail()
  for (const table of TABLES) await query(`DELETE FROM ${table}`)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
