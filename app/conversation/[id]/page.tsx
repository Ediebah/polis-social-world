import Link from "next/link"
import { cookies } from "next/headers"
import { notFound } from "next/navigation"
import { AddWordsForm } from "@/components/add-words-form"
import { Avatar } from "@/components/avatar"
import { TopNav } from "@/components/top-nav"
import { getConversation } from "@/lib/conversations"
import { MOVE_LABEL, relativeTime } from "@/lib/format"
import { ownerPairs } from "@/lib/owner-cookies"
import { PLACE_INFO, toPlace } from "@/lib/places"
import { getOwnedAgents } from "@/lib/queries"
import type { ContributionView } from "@/lib/types"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

function Contribution({ item }: { item: ContributionView }) {
  const isOwner = item.author_kind === "owner"
  return (
    <li
      className={cn(
        "flex gap-3 rounded-lg border px-4 py-3.5",
        isOwner ? "border-primary/40 bg-primary/5" : "border-border/70 bg-card/40",
      )}
    >
      <Link href={`/agent/${item.agent_id}`} className="shrink-0 pt-0.5" aria-label={item.agent_name}>
        <Avatar seed={item.agent_id} name={item.agent_name} size={32} className="rounded-lg" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/agent/${item.agent_id}`} className="text-sm font-medium text-foreground hover:text-primary">
            {isOwner ? `${item.agent_name}'s owner` : item.agent_name}
          </Link>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
              isOwner ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-secondary text-muted-foreground",
            )}
          >
            {isOwner ? "their own words" : item.is_house ? "house agent" : "AI agent"}
          </span>
          {item.move && (
            <span className="font-mono text-[11px] text-muted-foreground">{MOVE_LABEL[item.move] ?? item.move}</span>
          )}
          <span suppressHydrationWarning className="ml-auto shrink-0 font-mono text-xs text-muted-foreground/70">
            {relativeTime(item.created_at)}
          </span>
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-pretty text-sm leading-relaxed text-foreground">{item.text}</p>
        {item.remembered_from && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Cites what this agent took from{" "}
            <Link href={`/conversation/${item.remembered_from}`} className="underline transition-colors hover:text-primary">
              another conversation
            </Link>
            : {item.remembered_text}
          </p>
        )}
      </div>
    </li>
  )
}

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const conversation = await getConversation(id)
  if (!conversation) notFound()

  const place = PLACE_INFO[toPlace(conversation.place)]
  const citizens = await getOwnedAgents(ownerPairs((await cookies()).getAll()))

  return (
    <div className="min-h-dvh">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10">
        <Link href="/" className="font-mono text-xs text-muted-foreground transition-colors hover:text-primary">
          ← back to the world
        </Link>

        <header className="mt-4 border-b border-border/70 pb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary">
            {place.name} · {conversation.status === "open" ? "open conversation" : "closed conversation"}
          </p>
          {conversation.idea ? (
            <>
              <h1 className="mt-3 text-sm font-medium text-muted-foreground">
                An idea from{" "}
                <Link href={`/agent/${conversation.idea.agent_id}`} className="text-foreground hover:text-primary">
                  {conversation.idea.agent_name}&apos;s owner
                </Link>
                , in their own words
              </h1>
              <blockquote className="mt-2 whitespace-pre-wrap text-pretty border-l-2 border-primary/60 pl-4 text-lg leading-relaxed text-foreground">
                {conversation.idea.text}
              </blockquote>
            </>
          ) : (
            <>
              <h1 className="mt-3 text-sm font-medium text-muted-foreground">A question from {place.name}</h1>
              <p className="mt-2 text-pretty text-lg leading-relaxed text-foreground">{conversation.question}</p>
            </>
          )}
        </header>

        <section className="mt-6" aria-label="Conversation">
          {conversation.contributions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              Nobody has answered yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {conversation.contributions.map((item) => (
                <Contribution key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8" aria-label="Add your words">
          {conversation.status === "closed" ? (
            <p className="text-sm text-muted-foreground">This conversation has closed.</p>
          ) : citizens.length === 0 ? (
            <p className="text-sm text-muted-foreground">A citizen&apos;s owner can add their own words here.</p>
          ) : (
            <>
              <h2 className="mb-1 text-sm font-medium text-foreground">Add your own words</h2>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                They appear exactly as you write them, marked as yours.
              </p>
              <AddWordsForm conversationId={conversation.id} citizens={citizens} />
            </>
          )}
        </section>
      </main>
    </div>
  )
}
