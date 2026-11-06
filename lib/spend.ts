// The only path to the model. Every call reserves its estimated cost against a
// shared daily budget before it runs, then settles to what the API reports. This
// is an application control on ESTIMATED spend, not a billing guarantee: check
// the provider's billing as well.
import {
  generateText,
  NoObjectGeneratedError,
  type GenerateTextResult,
  type LanguageModelUsage,
  type Output,
  type ToolSet,
} from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { query } from "./db"
import { retryOnConflict } from "./occ"

// Claude via the Anthropic API directly (reads ANTHROPIC_API_KEY from env).
const MODEL = anthropic("claude-haiku-4-5-20251001")

// Haiku 4.5 list price is $1 / $5 per million tokens, so one token costs exactly
// 1 / 5 micro-USD. Update these alongside MODEL.
const INPUT_MICROS_PER_TOKEN = 1
const OUTPUT_MICROS_PER_TOKEN = 5

// Deliberately pessimistic, since this only holds budget until the call settles:
// English averages closer to 4 characters per token, and the overhead covers the
// message framing and any output schema the SDK adds to the prompt.
const CHARS_PER_TOKEN = 3
const INPUT_OVERHEAD_TOKENS = 400

const DEFAULT_DAILY_CAP_USD = 2
const MICROS_PER_USD = 1_000_000

// Journal and ask are reachable by visitors, so they can only use part of the
// budget. Whatever they do, scheduled ticks can still spend the rest.
const VISITOR_SHARE_OF_CAP = 0.5

const MODEL_TIMEOUT_MS = 20_000

export type SpendPurpose = "tick" | "journal" | "ask"

export class SpendBlockedError extends Error {
  constructor(readonly reason: "paused" | "cap") {
    super(`model call blocked: ${reason}`)
    this.name = "SpendBlockedError"
  }
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

function dailyCapUsd(): number {
  const raw = process.env.DAILY_SPEND_CAP_USD?.trim()
  const usd = raw ? Number(raw) : Number.NaN
  return Number.isFinite(usd) && usd >= 0 ? usd : DEFAULT_DAILY_CAP_USD
}

function limitMicros(purpose: SpendPurpose): number {
  const cap = dailyCapUsd() * MICROS_PER_USD
  return Math.floor(purpose === "tick" ? cap : cap * VISITOR_SHARE_OF_CAP)
}

// Atomically adds to the day's total only if it stays within the limit. Two
// concurrent reservations can't both pass on a stale total: the loser's write
// conflicts (40001), and on retry the WHERE clause sees the winner's reservation.
async function reserve(day: string, micros: number, limit: number): Promise<boolean> {
  return retryOnConflict(async () => {
    const now = new Date().toISOString()
    await query(
      `INSERT INTO spend_days (day, reserved_micros, calls, updated_at) VALUES ($1, 0, 0, $2)
       ON CONFLICT (day) DO NOTHING`,
      [day, now],
    )
    const r = await query(
      `UPDATE spend_days
          SET reserved_micros = reserved_micros + $2, calls = calls + 1, updated_at = $3
        WHERE day = $1 AND reserved_micros + $2 <= $4`,
      [day, micros, now, limit],
    )
    return (r.rowCount ?? 0) === 1
  })
}

// Swaps the estimate for the reported cost. Never throws: if the usage is missing
// or the write fails, the (higher) estimate stands, which errs toward spending less.
async function settle(day: string, estimate: number, usage: LanguageModelUsage | undefined) {
  if (usage?.inputTokens === undefined || usage.outputTokens === undefined) return
  const actual = usage.inputTokens * INPUT_MICROS_PER_TOKEN + usage.outputTokens * OUTPUT_MICROS_PER_TOKEN
  try {
    await retryOnConflict(() =>
      query(
        `UPDATE spend_days
            SET reserved_micros = GREATEST(reserved_micros + $2, 0), updated_at = $3
          WHERE day = $1`,
        [day, actual - estimate, new Date().toISOString()],
      ),
    )
  } catch (err) {
    console.error("[polis] spend settle failed; keeping estimate:", err)
  }
}

interface BudgetedCall<OUTPUT extends Output.Output> {
  system: string
  prompt: string
  maxOutputTokens: number
  output?: OUTPUT
}

// Throws SpendBlockedError when paused or over budget, without calling the model.
// A failed call keeps its full reservation, since the API may still have billed it.
export async function generateWithinBudget<OUTPUT extends Output.Output = Output.Output<string, string>>(
  purpose: SpendPurpose,
  { system, prompt, maxOutputTokens, output }: BudgetedCall<OUTPUT>,
): Promise<GenerateTextResult<ToolSet, OUTPUT>> {
  if (await isPaused()) throw new SpendBlockedError("paused")

  const day = utcDay()
  const inputTokens = Math.ceil((system.length + prompt.length) / CHARS_PER_TOKEN) + INPUT_OVERHEAD_TOKENS
  const estimate = inputTokens * INPUT_MICROS_PER_TOKEN + maxOutputTokens * OUTPUT_MICROS_PER_TOKEN
  if (!(await reserve(day, estimate, limitMicros(purpose)))) throw new SpendBlockedError("cap")

  try {
    const result = await generateText<ToolSet, OUTPUT>({
      model: MODEL,
      system,
      prompt,
      maxOutputTokens,
      experimental_output: output,
      // One reservation pays for one attempt. The SDK's automatic retries would
      // each cost money the budget never saw.
      maxRetries: 0,
      timeout: { totalMs: MODEL_TIMEOUT_MS },
    })
    await settle(day, estimate, result.usage)
    return result
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) await settle(day, estimate, err.usage)
    throw err
  }
}

// The flag lives in the same table as seed_lock. Reads go through named counters
// (see getWorldCounts), so it never shows up in the public totals.
export async function isPaused(): Promise<boolean> {
  const { rows } = await query<{ value: string | number }>(
    `SELECT value FROM world_counters WHERE counter_name = 'world_paused' AND shard = 0`,
  )
  return Number(rows[0]?.value ?? 0) === 1
}

export async function setPaused(paused: boolean): Promise<void> {
  await retryOnConflict(() =>
    query(
      `INSERT INTO world_counters (counter_name, shard, value) VALUES ('world_paused', 0, $1)
       ON CONFLICT (counter_name, shard) DO UPDATE SET value = EXCLUDED.value`,
      [paused ? 1 : 0],
    ),
  )
}

export async function getSpendStatus() {
  const day = utcDay()
  const [{ rows }, paused] = await Promise.all([
    query<{ reserved_micros: string | number; calls: string | number }>(
      `SELECT reserved_micros, calls FROM spend_days WHERE day = $1`,
      [day],
    ),
    isPaused(),
  ])
  return {
    day,
    estimatedSpendUsd: Number(rows[0]?.reserved_micros ?? 0) / MICROS_PER_USD,
    capUsd: dailyCapUsd(),
    calls: Number(rows[0]?.calls ?? 0),
    paused,
  }
}
