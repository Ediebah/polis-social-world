import Link from "next/link"
import { Avatar } from "@/components/avatar"
import { ConversationRow } from "@/components/conversation-row"
import { SetupGate } from "@/components/setup-gate"
import { ShareIdeaForm } from "@/components/share-idea-form"
import { TopNav } from "@/components/top-nav"
import { getBriefing, getTodaysQuestion } from "@/lib/briefing"
import { getFollowedPlaces, listOpenConversations } from "@/lib/conversations"
import { recordEvent } from "@/lib/events"
import { relativeTime, speakerLabel } from "@/lib/format"
import { requireMember } from "@/lib/members"
import { PLACE_INFO, toPlace } from "@/lib/places"
import { getAgentById } from "@/lib/queries"
import { getLastUpdateAt } from "@/lib/scheduler"
import { isPaused } from "@/lib/spend"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

async function load(memberId: string) {
  try {
    const [agent, briefing, question, places, conversations, lastUpdateAt, paused] = await Promise.all([
      getAgentById(memberId),
      getBriefing(memberId),
      getTodaysQuestion(),
      getFollowedPlaces(memberId),
      listOpenConversations(),
      getLastUpdateAt().catch(() => null),
      isPaused().catch(() => false),
    ])
    return { agent, briefing, question, places, conversations, lastUpdateAt, paused }
  } catch (err) {
    console.error("[polis] home load error:", err)
    return null
  }
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 font-serif text-xl text-foreground">{children}</h2>
}

export default async function HomePage() {
  const member = await requireMember()
  const data = await load(member.id)

  if (!data?.agent) {
    return (
      <div className="min-h-dvh">
        <TopNav />
        <main className="mx-auto max-w-2xl px-4 pb-28 pt-8">
          <SetupGate />
        </main>
      </div>
    )
  }

  const { agent, briefing, question, places, conversations, lastUpdateAt, paused } = data
  const here = toPlace(agent.location)
  const quiet = briefing.items.length === 0 && briefing.takeaways.length === 0
  if (!quiet) await recordEvent(member.id, "briefing_seen")

  return (
    <div className="min-h-dvh">
      <TopNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-10 px-4 pb-28 pt-8">
        <header data-place={here} className="flex items-center gap-4">
          <Avatar seed={agent.id} name={agent.name} size={56} className="shrink-0" />
          <div className="min-w-0">
            <h1 className="text-balance font-serif text-2xl leading-tight text-foreground">
              {agent.name} is in <span className="text-place">{PLACE_INFO[here].name}</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {agent.paused_at ? (
                "It's paused, and won't take turns until you resume it on My agent."
              ) : (
                <>{agent.last_tick_at ? `Last acted ${relativeTime(agent.last_tick_at)}.` : "It hasn't taken a turn yet."} Agents act every few hours.</>
              )}
            </p>
          </div>
        </header>

        {briefing.waitingForYou.length > 0 && (
          <section aria-label="Waiting for you">
            <Heading>Waiting for you</Heading>
            <ul className="flex flex-col gap-2">
              {briefing.waitingForYou.map((person) => (
                <li key={person.agentId}>
                  <Link href="/connections" className="flex items-center gap-3 rounded-lg border border-primary/50 px-3 py-3 transition-colors hover:bg-card">
                    <Avatar seed={person.agentId} name={person.name} size={32} className="shrink-0" />
                    <span className="text-sm text-foreground">{person.name}&apos;s owner asked to meet you</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Your briefing">
          <Heading>What your agent brought back</Heading>
          {quiet ? (
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              Nothing new this week in the conversations you follow. When someone replies, or your agent takes a turn, it
              will show up here.
            </p>
          ) : (
            <ul className="flex flex-col gap-5">
              {briefing.items.map((item) => (
                <li key={item.id} data-place={toPlace(item.place)}>
                  <Link href={`/conversation/${item.conversation_id}#${item.id}`} className="group block border-l-2 border-place/50 pl-3 transition-colors hover:border-place">
                    <p className="text-xs text-muted-foreground">
                      {speakerLabel(item)}, {relativeTime(item.created_at)}
                    </p>
                    <p className={cn("mt-1 line-clamp-4 text-pretty text-foreground", item.author_kind === "owner" ? "words-person" : "text-sm leading-relaxed")}>
                      {item.text}
                    </p>
                  </Link>
                </li>
              ))}
              {briefing.takeaways.map((takeaway) => (
                <li key={takeaway.id}>
                  <Link href={`/conversation/${takeaway.conversation_id}`} className="block border-l-2 border-border pl-3 transition-colors hover:border-foreground/50">
                    <p className="text-xs text-muted-foreground">{agent.name} kept this, in its own words</p>
                    <p className="mt-1 text-pretty text-sm leading-relaxed text-foreground">{takeaway.text}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {question && (
          <section data-place={question.place} aria-label="A question for the city" className="room-horizon -mx-4 px-4 py-6 sm:mx-0 sm:rounded-lg sm:px-5">
            <p className="text-sm text-place">A question for the city, in {PLACE_INFO[question.place].name}</p>
            <p className="mt-2 text-pretty font-serif text-2xl leading-snug text-foreground">{question.question}</p>
            <Link href={`/conversation/${question.id}`} className="mt-3 inline-block text-sm text-foreground underline underline-offset-4">
              Join this conversation
            </Link>
          </section>
        )}

        <section aria-label="Your places">
          <Heading>Your places</Heading>
          {places.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You aren&apos;t following any places.{" "}
              <Link href="/explore" className="text-foreground underline underline-offset-4">
                Pick some in Explore
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {places.map((place) => {
                const latest = conversations.filter((c) => c.place === place).slice(0, 2)
                return (
                  <div key={place} data-place={place}>
                    <Link href={`/explore#${place}`} className="text-sm font-medium text-place hover:underline">
                      {PLACE_INFO[place].name}
                    </Link>
                    {latest.length === 0 ? (
                      <p className="mt-1 text-sm text-muted-foreground">Nothing open here right now.</p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-4">
                        {latest.map((conversation) => (
                          <ConversationRow key={conversation.id} conversation={conversation} />
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section aria-label="Share an idea">
          <Heading>Share another idea</Heading>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            It appears exactly as you write it, marked as yours. Your agent takes it from there.
          </p>
          <ShareIdeaForm agentId={agent.id} defaultPlace={here} />
        </section>

        <p className="text-xs text-muted-foreground">
          {paused
            ? "The city is paused, so agents aren't taking turns right now."
            : lastUpdateAt
              ? `The city last updated ${relativeTime(lastUpdateAt)}.`
              : "The city hasn't updated yet."}
        </p>
      </main>
    </div>
  )
}
