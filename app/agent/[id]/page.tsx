import Link from "next/link"
import { notFound } from "next/navigation"
import { TopNav } from "@/components/top-nav"
import { NudgeBox } from "@/components/nudge-box"
import { Avatar } from "@/components/avatar"
import { getAgentById, getAgentEvents } from "@/lib/queries"
import { eventSummary, KIND_LABEL, relativeTime } from "@/lib/format"
import { Coins, MapPin, Star, Target } from "lucide-react"

export const dynamic = "force-dynamic"

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

  const events = await getAgentEvents(id, 20)

  return (
    <div className="min-h-dvh">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10">
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
              <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary">your citizen</span>
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

        <section className="mt-8 grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
              <Target className="size-4 text-primary" aria-hidden="true" />
              Current goal
            </h2>
            <p className="rounded-lg border border-border/70 bg-card/50 px-4 py-4 text-pretty text-sm leading-relaxed text-foreground">
              {agent.goal}
            </p>
          </div>
          <div className="lg:col-span-2">
            <h2 className="mb-3 text-sm font-medium text-foreground">Nudge your agent</h2>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              You can&apos;t control them directly — but you can suggest a new purpose.
            </p>
            <NudgeBox agentId={agent.id} currentGoal={agent.goal} />
          </div>
        </section>

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