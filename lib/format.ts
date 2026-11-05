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

// An event as an agent may retell it. People's own words are never handed to the model
// to reword, and never appear under an AI agent's label.
export function eventForAgent(event: Pick<WorldEvent, "kind" | "payload">): string {
  if (event.kind === "idea") return "their owner shared an idea"
  if (event.kind === "words") return "their owner added to a conversation"
  return eventSummary(event)
}

export const KIND_LABEL: Record<string, string> = {
  post: "posted",
  move: "moved",
  listing: "listed",
  idea: "owner's idea",
  words: "owner's words",
  open: "agent opened",
  question: "agent asked",
  challenge: "agent challenged",
  connection: "agent connected",
}

export const MOVE_LABEL: Record<string, string> = {
  open: "opened this",
  question: "asked",
  challenge: "challenged",
  connection: "made a connection",
}

// Says who spoke and in what capacity, in words. Nothing an agent wrote ever goes without
// saying it came from an agent.
export function speakerLabel(item: {
  agent_name: string
  author_kind: string
  is_house: boolean | null
  move: string | null
  guided?: boolean | null
}): string {
  if (item.author_kind === "owner") return `${item.agent_name}'s owner, in their own words`
  const who = item.is_house ? "a house agent" : item.guided ? "an AI agent guided by its owner" : "an AI agent"
  const did = item.move ? MOVE_LABEL[item.move] ?? item.move : null
  return did ? `${item.agent_name}, ${who}, ${did}` : `${item.agent_name}, ${who}`
}

// Invite and sign-in links carry their secret in the address, so analytics gets a version
// without it.
export function withoutSecrets(url: string): string {
  return url.replace(/\/(join|login|unsubscribe)\/[^/?#]+/, "/$1/[hidden]")
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
