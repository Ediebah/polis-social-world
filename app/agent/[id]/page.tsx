import Link from "next/link"
import { cookies } from "next/headers"
import { notFound } from "next/navigation"
import { TopNav } from "@/components/top-nav"
import { NudgeBox } from "@/components/nudge-box"
import { Avatar } from "@/components/avatar"
import { getAgentById, getAgentEvents, ownsAgent } from "@/lib/queries"
import { query } from "@/lib/db"
import { cn } from "@/lib/utils"
import { eventSummary, KIND_LABEL, relativeTime } from "@/lib/format"
import { Coins, MapPin, Star, Target, Users } from "lucide-react"
import { ClaimMyCitizen } from "@/components/claim-my-citizen"
import { AgentJournal } from "@/components/agent-journal"

export const dynamic = "force-dynamic"

type Connection = { other_id: string; other_name: string; sentiment: number }

function bondLabel(s: number): string {
  if (s >= 40) return "ally"
  if (s >= 20) return "friendly"
  if (s > 0) return "acquainted"
  return "wary"
}

function bondStyle(s: number): string {
  if (s >= 40) return "text-emerald-300 border-emerald-400/30 bg-emerald-400/10"
  if (s >= 20) return "text-sky-300 border-sky-400/30 bg-sky-400/10"
  if (s > 0) return "text-muted-foreground border-border bg-secondary"
  return "text-amber-300 border-amber-400/30 bg-amber-400/10"
}

async function getConnections(id: string): Promise<Connection[]> {
  try {
    const { rows } = await query<Connection>(
      `SELECT r.other_id, a.name AS other_name, r.sentiment
         FROM relationships r
         JOIN agents a ON a.id = r.other_id
        WHERE r.agent_id = $1
        ORDER BY r.sentiment DESC
        LIMIT 12`,
      [id],
    )
    return rows
  } catch {
    // relationships table may not exist yet (before setup) — fail soft.
    return []
  }
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-card/50 px-4 py-3.5">
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-mono text-xl font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const agent = await getAgentById(id)
  if (!agent) notFound()

  // True only for the browser that spawned this citizen (holds the owner cookie).
  const ownerToken = (await cookies()).get(`polis-own-${id}`)?.value
  const isOwner = await ownsAgent(id, ownerToken)

  const [events, connections] = await Promise.all([getAgentEvents(id, 20), getConnections(id)])

  return (
    <div className="min-h-dvh">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10">
        <ClaimMyCitizen id={agent.id} name={agent.name} />
        <Link
          href="/"
          className="font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          ← back to the world
        </Link>

        <header className="mt-4 flex flex-col gap-4 border-b border-border/70 pb-8 sm:flex-row sm:items-start sm:gap-5">
          <Avatar
            seed={agent.id}
            name={agent.name}
            size={72}
            className="shrink-0 rounded-2xl ring-1 ring-border/70"
          />

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary">
                {isOwner ? "your citizen" : "a citizen"}
              </span>
              <span
                className={
                  agent.status === "alive"
                    ? "rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary"
                    : "rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                }
              >
                {agent.status}
              </span>
            </div>
            <h1 className="text-balance text-3xl font-semibold text-foreground">{agent.name}</h1>
            <div className="flex flex-wrap gap-2">
              {agent.persona.traits.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
            {agent.persona.backstory && (
              <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
                {agent.persona.backstory}
              </p>
            )}
          </div>
        </header>

        <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={<Coins className="size-3" aria-hidden="true" />} label="Balance" value={agent.balance.toLocaleString()} />
          <Stat icon={<Star className="size-3" aria-hidden="true" />} label="Reputation" value={String(agent.reputation)} />
          <Stat icon={<MapPin className="size-3" aria-hidden="true" />} label="Location" value={agent.location} />
          <Stat
            icon={<Target className="size-3" aria-hidden="true" />}
            label="Ticks"
            value={String(agent.next_tick_seq)}
          />
        </section>

        <AgentJournal agentId={agent.id} />

        <section className="mt-8 grid gap-6 lg:grid-cols-5">
          <div className={isOwner ? "lg:col-span-3" : "lg:col-span-5"}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
              <Target className="size-4 text-primary" aria-hidden="true" />
              Current goal
            </h2>
            <p className="rounded-lg border border-border/70 bg-card/50 px-4 py-4 text-pretty text-sm leading-relaxed text-foreground">
              {agent.goal}
            </p>
          </div>
          {isOwner && (
            <div className="lg:col-span-2">
              <h2 className="mb-3 text-sm font-medium text-foreground">Nudge your agent</h2>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                You can&apos;t control them directly — but you can suggest a new purpose.
              </p>
              <NudgeBox agentId={agent.id} currentGoal={agent.goal} />
            </div>
          )}
        </section>

        {connections.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
              <Users className="size-4 text-primary" aria-hidden="true" />
              Connections
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {connections.map((c) => (
                <li key={c.other_id}>
                  <Link
                    href={`/agent/${c.other_id}`}
                    className="flex items-center gap-3 rounded-lg border border-border/70 bg-card/40 px-3 py-2.5 transition-colors hover:border-primary/40"
                  >
                    <Avatar seed={c.other_id} name={c.other_name} size={32} className="shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.other_name}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                        bondStyle(c.sentiment),
                      )}
                    >
                      {bondLabel(c.sentiment)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium text-foreground">Recent activity</h2>
          {events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              This agent hasn&apos;t done anything yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-border/70 bg-card/40 px-4 py-3"
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
                    {KIND_LABEL[e.kind] ?? e.kind}
                  </span>
                  <span className="min-w-0 flex-1 text-pretty text-sm text-muted-foreground">
                    {eventSummary(e)}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground/70">{relativeTime(e.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}