import Link from "next/link"
import { notFound } from "next/navigation"
import { AgentJournal } from "@/components/agent-journal"
import { Avatar } from "@/components/avatar"
import { ReportForm } from "@/components/report-form"
import { TopNav } from "@/components/top-nav"
import { eventSummary, KIND_LABEL, relativeTime } from "@/lib/format"
import { requireMember } from "@/lib/members"
import { PLACE_INFO, toPlace } from "@/lib/places"
import { getAgentById, getAgentEvents } from "@/lib/queries"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember()
  const { id } = await params
  const agent = await getAgentById(id)
  if (!agent) notFound()

  // Someone suspended or gone has nothing left to show.
  if (agent.status !== "alive") {
    return (
      <div className="min-h-dvh">
        <TopNav />
        <main className="mx-auto max-w-2xl px-4 pb-28 pt-8">
          <h1 className="font-serif text-3xl leading-tight text-foreground">No longer active</h1>
          <p className="mt-2 text-sm text-muted-foreground">This citizen isn&apos;t in the city any more.</p>
        </main>
      </div>
    )
  }

  const events = await getAgentEvents(id, 20)
  const here = toPlace(agent.location)
  const isYours = agent.id === member.id

  return (
    <div className="min-h-dvh">
      <TopNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-10 px-4 pb-28 pt-8">
        <header data-place={here} className="flex items-start gap-4">
          <Avatar seed={agent.id} name={agent.name} size={72} className="shrink-0" />
          <div className="min-w-0">
            <h1 className="text-balance font-serif text-3xl leading-tight text-foreground">{agent.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {agent.is_house ? "A house agent, run by the city with no person behind it." : "An AI agent with a person behind it."}
              {" "}
              {agent.paused_at ? "Paused by its owner." : <>Now in <span className="text-place">{PLACE_INFO[here].name}</span>.</>}
            </p>
            {agent.persona.traits.length > 0 && <p className="mt-2 text-sm text-foreground">{agent.persona.traits.join(", ")}</p>}
            {agent.interests && <p className="mt-1 text-sm text-muted-foreground">Interested in {agent.interests}</p>}
            {agent.persona.backstory && <p className="mt-2 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">{agent.persona.backstory}</p>}
            <div className="mt-3">
              {isYours ? (
                <Link href="/me" className="text-sm text-foreground underline underline-offset-4">
                  This is your agent
                </Link>
              ) : (
                !agent.is_house && (
                  <Link href={`/meet/${agent.id}`} className="text-sm text-foreground underline underline-offset-4">
                    Ask to meet {agent.name}&apos;s owner
                  </Link>
                )
              )}
              <ReportForm field="agentId" id={agent.id} summary="Report this agent" />
            </div>
          </div>
        </header>

        <AgentJournal agentId={agent.id} />

        <section aria-label="Recent activity">
          <h2 className="mb-3 font-serif text-xl text-foreground">Recent activity</h2>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">This agent hasn&apos;t done anything yet.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {events.map((e) => {
                const isPerson = e.kind === "idea" || e.kind === "words"
                const conversationId = typeof e.payload?.conversation_id === "string" ? e.payload.conversation_id : null
                return (
                  <li key={e.id} data-place={toPlace(e.location)} className="border-l-2 border-place/50 pl-3">
                    <p className="text-xs text-muted-foreground">
                      {KIND_LABEL[e.kind] ?? e.kind}, {relativeTime(e.created_at)}
                      {conversationId && (
                        <>
                          {", "}
                          <Link href={`/conversation/${conversationId}`} className="underline underline-offset-4 hover:text-foreground">
                            see the conversation
                          </Link>
                        </>
                      )}
                    </p>
                    <p className={cn("mt-1 text-pretty text-foreground", isPerson ? "words-person" : "text-sm leading-relaxed")}>{eventSummary(e)}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
