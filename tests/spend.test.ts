import { describe, expect, it, vi } from "vitest"
import { APICallError, Output } from "ai"
import { z } from "zod"
import { generateWithinBudget, getSpendStatus, setPaused, SpendBlockedError } from "@/lib/spend"
import { failNext, query } from "./helpers/fake-db"
import { modelCallCount, model, onModelCall, textResult } from "./helpers/fake-model"

// 6 characters / 3 + 400 overhead = 402 input tokens at 1 micro-USD each, plus
// 100 output tokens at 5 micro-USD each: a 902 micro-USD reservation.
const CALL = { system: "sys", prompt: "abc", maxOutputTokens: 100 }
const RESERVED_USD = 902 / 1_000_000
// textResult reports 100 input + 20 output tokens: 100 + 100 = 200 micro-USD.
const SETTLED_USD = 200 / 1_000_000

function capAt(usd: number) {
  vi.stubEnv("DAILY_SPEND_CAP_USD", String(usd))
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe("generateWithinBudget", () => {
  it("returns the model's answer and records its actual cost", async () => {
    onModelCall(async () => textResult("hello"))

    const result = await generateWithinBudget("tick", CALL)

    expect(result.text).toBe("hello")
    const status = await getSpendStatus()
    expect(status.estimatedSpendUsd).toBeCloseTo(SETTLED_USD, 9)
    expect(status.calls).toBe(1)
  })

  it("sends the output token limit to the model", async () => {
    await generateWithinBudget("tick", CALL)

    expect(model.doGenerateCalls[0].maxOutputTokens).toBe(100)
  })

  it("refuses a call over the daily cap without calling the model", async () => {
    capAt(0.0005)

    await expect(generateWithinBudget("tick", CALL)).rejects.toMatchObject({ reason: "cap" })

    expect(modelCallCount()).toBe(0)
    expect((await getSpendStatus()).calls).toBe(0)
  })

  it("counts in-flight calls, so two calls can't both spend the last of the budget", async () => {
    capAt(0.0012)
    const inFlight = deferred<ReturnType<typeof textResult>>()
    onModelCall(() => inFlight.promise)

    const first = generateWithinBudget("tick", CALL)
    await vi.waitFor(() => expect(modelCallCount()).toBe(1))

    await expect(generateWithinBudget("tick", CALL)).rejects.toBeInstanceOf(SpendBlockedError)
    expect((await getSpendStatus()).estimatedSpendUsd).toBeCloseTo(RESERVED_USD, 9)

    inFlight.resolve(textResult("done"))
    await first
    onModelCall(async () => textResult("after"))
    await expect(generateWithinBudget("tick", CALL)).resolves.toMatchObject({ text: "after" })
  })

  it("makes one attempt on a retryable failure and keeps the reservation", async () => {
    onModelCall(async () => {
      throw new APICallError({
        message: "overloaded",
        url: "https://api.anthropic.com/v1/messages",
        requestBodyValues: {},
        statusCode: 529,
        isRetryable: true,
      })
    })

    await expect(generateWithinBudget("tick", CALL)).rejects.toThrow()

    expect(modelCallCount()).toBe(1)
    expect((await getSpendStatus()).estimatedSpendUsd).toBeCloseTo(RESERVED_USD, 9)
  })

  it("records the cost when the model's structured output can't be parsed", async () => {
    onModelCall(async () => textResult("not json"))

    await expect(
      generateWithinBudget("tick", { ...CALL, output: Output.object({ schema: z.object({ a: z.string() }) }) }),
    ).rejects.toThrow()

    expect((await getSpendStatus()).estimatedSpendUsd).toBeCloseTo(SETTLED_USD, 9)
  })

  it("retries the reservation after a concurrency conflict", async () => {
    failNext(/UPDATE spend_days/)

    await generateWithinBudget("tick", CALL)

    expect(modelCallCount()).toBe(1)
    expect((await getSpendStatus()).calls).toBe(1)
  })

  it("keeps the reservation when recording the actual cost fails", async () => {
    failNext(/GREATEST/, "XX000")

    await expect(generateWithinBudget("tick", CALL)).resolves.toMatchObject({ text: "ok" })

    expect((await getSpendStatus()).estimatedSpendUsd).toBeCloseTo(RESERVED_USD, 9)
  })

  it("refuses to spend if the budget can't be read", async () => {
    failNext(/INSERT INTO spend_days/, "XX000")

    await expect(generateWithinBudget("tick", CALL)).rejects.toMatchObject({ code: "XX000" })

    expect(modelCallCount()).toBe(0)
  })

  it("stops other call types at half the cap so ticks keep running", async () => {
    capAt(0.002)
    await query(`INSERT INTO spend_days (day, reserved_micros, calls, updated_at) VALUES ($1, 500, 0, now())`, [
      new Date().toISOString().slice(0, 10),
    ])

    await expect(generateWithinBudget("journal", CALL)).rejects.toMatchObject({ reason: "cap" })
    await expect(generateWithinBudget("ask", CALL)).rejects.toMatchObject({ reason: "cap" })
    await expect(generateWithinBudget("tick", CALL)).resolves.toMatchObject({ text: "ok" })
  })

  it("starts each UTC day with a fresh budget and settles against the day it reserved", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-02T23:59:59Z"))
    capAt(0.001)
    const inFlight = deferred<ReturnType<typeof textResult>>()
    onModelCall(() => inFlight.promise)

    const lateCall = generateWithinBudget("tick", CALL)
    await vi.waitFor(() => expect(modelCallCount()).toBe(1))
    vi.setSystemTime(new Date("2026-11-03T00:00:01Z"))
    inFlight.resolve(textResult("done"))
    await lateCall

    const { rows } = await query(`SELECT day, reserved_micros FROM spend_days ORDER BY day`)
    expect(rows.map((r) => [r.day, Number(r.reserved_micros)])).toEqual([["2026-11-02", 200]])

    onModelCall(async () => textResult("new day"))
    await expect(generateWithinBudget("tick", CALL)).resolves.toMatchObject({ text: "new day" })
    expect((await getSpendStatus()).day).toBe("2026-11-03")
  })
})

describe("daily cap setting", () => {
  it.each([
    ["unset", undefined, 2],
    ["a custom value", "5.5", 5.5],
    ["not a number", "lots", 2],
    ["negative", "-1", 2],
    ["zero", "0", 0],
  ])("%s", async (_label, value, want) => {
    if (value !== undefined) vi.stubEnv("DAILY_SPEND_CAP_USD", value)

    expect((await getSpendStatus()).capUsd).toBe(want)
  })

  it("a zero cap blocks every call", async () => {
    capAt(0)

    await expect(generateWithinBudget("tick", CALL)).rejects.toMatchObject({ reason: "cap" })
  })
})

describe("pause switch", () => {
  it("blocks calls while paused and allows them after resuming", async () => {
    await setPaused(true)

    await expect(generateWithinBudget("tick", CALL)).rejects.toMatchObject({ reason: "paused" })
    expect(modelCallCount()).toBe(0)
    expect((await getSpendStatus()).paused).toBe(true)

    await setPaused(false)

    await expect(generateWithinBudget("tick", CALL)).resolves.toMatchObject({ text: "ok" })
    expect((await getSpendStatus()).paused).toBe(false)
  })

  it("does not change the public action and population counts", async () => {
    await setPaused(true)

    const { getWorldCounts } = await import("@/lib/queries")
    expect(await getWorldCounts()).toEqual({ population: 0, total_actions: 0 })
  })
})
