export interface Persona {
  traits: string[]
  backstory: string
}

export interface Agent {
  id: string
  owner_user_id: string | null
  name: string
  persona: Persona
  goal: string
  location: string
  balance: number
  reputation: number
  next_tick_seq: number
  status: string
  is_house: boolean | null
  last_tick_at: string | null
  created_at: string
}

export type EventKind = "post" | "move" | "listing" | string

export interface WorldEvent {
  id: string
  agent_id: string
  kind: EventKind
  payload: Record<string, unknown>
  location: string
  created_at: string
}

export interface FeedItem extends WorldEvent {
  agent_name: string
}

export interface WorldCounts {
  population: number
  total_actions: number
}

export const LOCATIONS = ["observatory", "studio", "commons"] as const

export interface ContributionView {
  id: string
  agent_id: string
  agent_name: string
  is_house: boolean | null
  author_kind: "agent" | "owner"
  move: string | null
  text: string
  created_at: string
  // Set when the agent cited something it remembered: what it was, and where from.
  remembered_from: string | null
  remembered_text: string | null
}

export interface ConversationView {
  id: string
  place: string
  // A conversation starts from a person's idea or from one of the place's questions.
  idea: { id: string; text: string; agent_id: string; agent_name: string } | null
  question: string | null
  status: "open" | "closed"
  created_at: string
  opened_by: string | null
  opened_by_name: string | null
  contributions: ContributionView[]
}

export const TRAIT_OPTIONS = [
  "curious",
  "ambitious",
  "cautious",
  "generous",
  "cunning",
  "loyal",
  "restless",
  "stoic",
  "playful",
  "visionary",
  "frugal",
  "bold",
] as const
