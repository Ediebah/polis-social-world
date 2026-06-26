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

// Strips common Markdown syntax so model-written text reads cleanly as prose and
// is spoken cleanly by TTS (e.g. a model that prefixes a journal with "# Day's
// End" — otherwise Polly reads the "#" aloud).
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images -> their text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings: "# Title" -> "Title"
    .replace(/^\s{0,3}>\s?/gm, "") // blockquotes
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, "") // list markers
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/^\s*([*_-]\s*){3,}$/gm, "") // horizontal rules
    .replace(/[ \t]+\n/g, "\n") // trailing spaces
    .replace(/\n{3,}/g, "\n\n") // collapse extra blank lines
    .trim()
}
