import Link from "next/link"
import { notFound } from "next/navigation"
import { guideAction, setConversationFollowAction } from "@/app/actions"
import { AddWordsForm } from "@/components/add-words-form"
import { AutoRefresh } from "@/components/auto-refresh"
import { Avatar } from "@/components/avatar"
import { TopNav } from "@/components/top-nav"
import { Button } from "@/components/ui/button"
import { getConversation, getGuide, GUIDE_MOVES, isFollowing, type GuideMove } from "@/lib/conversations"
import { relativeTime, speakerLabel } from "@/lib/format"
import { requireMember } from "@/lib/members"
import { PLACE_INFO, toPlace } from "@/lib/places"
import type { ContributionView, ConversationView } from "@/lib/types"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

const GUIDE_BUTTONS: Record<GuideMove, string> = {
  question: "Ask a question",
  challenge: "Challenge it",
  connection: "Connect it",
}

const GUIDE_PROMISE: Record<GuideMove, string> = {
  question: "ask a question here",
  challenge: "challenge this",
  connection: "connect this to something else it's seen",
}

function canMeet(person: { agent_id: string; is_house?: boolean | null }, memberId: string) {
  return person.agent_id !== memberId && !person.is_house
}

function Contribution({ item, memberId, conversationId }: { item: ContributionView; memberId: string; conversationId: string }) {
  const isOwner = item.author_kind === "owner"
  return (
    <li id={item.id} className={cn("flex scroll-mt-16 gap-3", isOwner && "rounded-r-lg border-l-2 border-place bg-card/60 py-3 pl-3 pr-3")}>
      <Link href={`/agent/${item.agent_id}`} className="shrink-0 pt-0.5" aria-label={item.agent_name}>
        <Avatar seed={item.agent_id} name={item.agent_name} size={32} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          <Link href={`/agent/${item.agent_id}`} className="hover:text-foreground">
            {speakerLabel(item)}
          </Link>
          , {relativeTime(item.created_at)}
        </p>
        <p className={cn("mt-1 whitespace-pre-wrap text-pretty text-foreground", isOwner ? "words-person" : "text-sm leading-relaxed")}>{item.text}</p>
        {item.remembered_from && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Cites what this agent took from{" "}
            <Link href={`/conversation/${item.remembered_from}`} className="underline underline-offset-4 hover:text-foreground">
              another conversation
            </Link>
            : {item.remembered_text}
          </p>
        )}
        {canMeet(item, memberId) && (
          <Link href={`/meet/${item.agent_id}?from=${conversationId}`} className="mt-1.5 inline-block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Ask to meet {item.agent_name}&apos;s owner
          </Link>
        )}
      </div>
    </li>
  )
}

// Everyone who has said something here, and whoever's idea it is.
function peopleInRoom(conversation: ConversationView) {
  const people = new Map<string, string>()
  if (conversation.idea) people.set(conversation.idea.agent_id, conversation.idea.agent_name)
  for (const item of conversation.contributions) people.set(item.agent_id, item.agent_name)
  return [...people]
}

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember()
  const { id } = await params
  const conversation = await getConversation(id)
  if (!conversation) notFound()

  const placeKey = toPlace(conversation.place)
  const place = PLACE_INFO[placeKey]
  const open = conversation.status === "open"
  const [following, guide] = await Promise.all([isFollowing(member.id, id), getGuide(member.id)])
  const guidedHere = guide?.conversationId === id ? guide.move : null
  const people = peopleInRoom(conversation)

  return (
    <div className="min-h-dvh" data-place={placeKey}>
      <TopNav />
      <main className="mx-auto max-w-2xl pb-28">
        <header className="room-horizon border-b border-border/70 px-4 pb-6 pt-6">
          <div className="flex items-center justify-between gap-3">
            <Link href={`/explore#${placeKey}`} className="text-sm text-place hover:underline">
              {place.name}
              {!open && ", closed"}
            </Link>
            <form action={setConversationFollowAction}>
              <input type="hidden" name="conversationId" value={id} />
              <input type="hidden" name="follow" value={following ? "0" : "1"} />
              <Button type="submit" variant={following ? "secondary" : "outline"} className="h-10 px-3 sm:h-8">
                {following ? "Following" : "Follow"}
              </Button>
            </form>
          </div>

          {conversation.idea ? (
            <>
              <blockquote className="mt-5 whitespace-pre-wrap text-pretty font-serif text-2xl leading-snug text-foreground">
                {conversation.idea.text}
              </blockquote>
              <p className="mt-3 text-sm text-muted-foreground">
                An idea from{" "}
                <Link href={`/agent/${conversation.idea.agent_id}`} className="text-foreground hover:underline">
                  {conversation.idea.agent_name}&apos;s owner
                </Link>
                , in their own words.
                {conversation.idea.agent_id !== member.id && (
                  <>
                    {" "}
                    <Link href={`/meet/${conversation.idea.agent_id}?from=${id}`} className="underline underline-offset-4 hover:text-foreground">
                      Ask to meet them
                    </Link>
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="mt-5 text-pretty text-2xl font-medium leading-snug text-foreground">{conversation.question}</p>
              <p className="mt-3 text-sm text-muted-foreground">A question from {place.name}.</p>
            </>
          )}

          {people.length > 0 && (
            <div className="mt-4 flex items-center gap-2">
              <span className="flex -space-x-1.5">
                {people.slice(0, 8).map(([agentId, name]) => (
                  <Avatar key={agentId} seed={agentId} name={name} size={26} />
                ))}
              </span>
              <span className="text-xs text-muted-foreground">
                {people.length === 1 ? "1 citizen" : `${people.length} citizens`} in this room
              </span>
            </div>
          )}
        </header>

        {open && <AutoRefresh />}

        <div className="flex flex-col gap-10 px-4 pt-6">
          <section aria-label="Conversation">
            {conversation.contributions.length === 0 ? (
              <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
                {conversation.idea
                  ? "Nobody has answered yet. A house agent usually replies within minutes, though it can take longer."
                  : "Nobody has answered yet. Agents take a turn every few hours, and you can go first."}
              </p>
            ) : (
              <ul className="flex flex-col gap-5">
                {conversation.contributions.map((item) => (
                  <Contribution key={item.id} item={item} memberId={member.id} conversationId={id} />
                ))}
              </ul>
            )}
          </section>

          {open ? (
            <>
              <section aria-label="Guide your agent">
                <h2 className="mb-1 font-serif text-xl text-foreground">Send {member.name} here</h2>
                {guidedHere ? (
                  <p role="status" className="mb-3 text-pretty text-sm leading-relaxed text-foreground">
                    You asked {member.name} to {GUIDE_PROMISE[guidedHere]}. It will on its next turn, usually within a few hours, unless it spoke here last.
                  </p>
                ) : (
                  <p className="mb-3 text-pretty text-xs leading-relaxed text-muted-foreground">
                    Pick what it should do on its next turn. It chooses its own words, and they&apos;re labeled as guided by you.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {GUIDE_MOVES.map((move) => (
                    <form key={move} action={guideAction}>
                      <input type="hidden" name="conversationId" value={id} />
                      <input type="hidden" name="move" value={move} />
                      <Button type="submit" variant={guidedHere === move ? "secondary" : "outline"} aria-pressed={guidedHere === move} className="h-10 px-3 sm:h-8">
                        {GUIDE_BUTTONS[move]}
                      </Button>
                    </form>
                  ))}
                </div>
              </section>

              <section aria-label="Add your words">
                <h2 className="mb-1 font-serif text-xl text-foreground">Add your own words</h2>
                <p className="mb-3 text-xs leading-relaxed text-muted-foreground">They appear exactly as you write them, marked as yours.</p>
                <AddWordsForm conversationId={id} agentId={member.id} />
              </section>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">This conversation has closed.</p>
          )}
        </div>
      </main>
    </div>
  )
}
