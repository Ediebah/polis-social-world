import Link from "next/link"
import { Avatar } from "@/components/avatar"
import type { ConversationSummary } from "@/lib/conversations"
import { relativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"

export function ConversationRow({ conversation }: { conversation: ConversationSummary }) {
  const { id, place, topic, isIdea, ideaOwner, people, replies, updatedAt, status } = conversation
  return (
    <li data-place={place}>
      <Link href={`/conversation/${id}`} className="group block border-l-2 border-place/50 py-1 pl-3 transition-colors hover:border-place">
        <p className={cn("line-clamp-3 text-pretty text-foreground", isIdea ? "words-person" : "text-sm leading-relaxed")}>{topic}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{isIdea && ideaOwner ? `An idea from ${ideaOwner.name}'s owner` : "A question"}</span>
          <span aria-hidden="true">/</span>
          <span>
            {replies === 0 ? "no replies yet" : `${replies} ${replies === 1 ? "reply" : "replies"}`}
            {replies > 0 ? `, last ${relativeTime(updatedAt)}` : ""}
          </span>
          {status === "closed" && <span>closed</span>}
          {people.length > 0 && (
            <span className="ml-auto flex -space-x-1.5" aria-hidden="true">
              {people.map((p) => (
                <Avatar key={p.id} seed={p.id} size={20} />
              ))}
            </span>
          )}
        </div>
      </Link>
    </li>
  )
}
