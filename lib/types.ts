export interface Persona {
  traits: string[]
  backstory: string
}

export interface Agent {
  id: string
  owner_user_id: string
  name: string
  persona: Persona
  goal: string
  location: string
  balance: number
  reputation: number
  next_tick_seq: number
  status: string
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

export const LOCATIONS = ["plaza", "market", "harbor", "observatory", "gardens", "foundry"] as const

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
