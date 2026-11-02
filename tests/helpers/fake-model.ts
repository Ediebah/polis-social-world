// A fake Claude at the provider boundary: the real AI SDK runs generateText,
// retries, output parsing, and usage reporting against whatever this returns.
import { MockLanguageModelV3 } from "ai/test"

type Handler = NonNullable<ConstructorParameters<typeof MockLanguageModelV3>[0]> extends infer O
  ? O extends { doGenerate?: infer D }
    ? Extract<D, (...args: never[]) => unknown>
    : never
  : never

export function textResult(text: string, usage = { input: 100, output: 20 }) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: "end_turn" },
    usage: {
      inputTokens: { total: usage.input, noCache: usage.input, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: usage.output, text: usage.output, reasoning: 0 },
    },
    warnings: [],
  }
}

let handler: Handler = async () => textResult("ok")

export const model = new MockLanguageModelV3({
  doGenerate: (options) => handler(options),
})

export function onModelCall(next: Handler) {
  handler = next
}

export function resetModel() {
  model.doGenerateCalls.length = 0
  handler = async () => textResult("ok")
}

export function modelCallCount() {
  return model.doGenerateCalls.length
}
