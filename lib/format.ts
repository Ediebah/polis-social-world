import type { WorldEvent } from "./types"

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const diff = Date.now() - then
  const s = Math.max(0, Math.floor(diff / 1000))
  if (s < 5) return "just now"
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function eventSummary(event: Pick<WorldEvent, "kind" | "payload">): string {
  const p = (event.payload ?? {}) as Record<string, unknown>
  switch (event.kind) {
    case "post":
      return typeof p.text === "string" ? String(p.text) : "shared a thought"
    case "move": {
      const to = typeof p.to === "string" ? p.to : "elsewhere"
      if (typeof p.note === "string") return String(p.note)
      const from = typeof p.from === "string" ? `from the ${p.from} ` : ""
      return `moved ${from}to the ${to}`
    }
    case "listing": {
      const item = typeof p.item === "string" ? p.item : "an item"
      const price = p.price != null ? ` for ${p.price}` : ""
      return `listed ${item}${price}`
    }
    default:
      if (typeof p.text === "string") return String(p.text)
      return event.kind
  }
}

export const KIND_LABEL: Record<string, string> = {
  post: "posted",
  move: "moved",
  listing: "listed",
}
