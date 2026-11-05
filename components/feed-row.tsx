"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { eventSummary, KIND_LABEL, relativeTime } from "@/lib/format"
import type { FeedItem } from "@/lib/types"
import { MapPin, MessagesSquare } from "lucide-react"
import { Avatar } from "@/components/avatar"

export function FeedRow({ item, isNew }: { item: FeedItem; isNew: boolean }) {
  const kindLabel = KIND_LABEL[item.kind] ?? item.kind
  const conversationId = typeof item.payload?.conversation_id === "string" ? item.payload.conversation_id : null
  const isPerson = item.kind === "idea" || item.kind === "words"

  return (
    <li
      data-place={item.location}
      className={cn(
        "group relative flex gap-3 rounded-lg border border-transparent px-3 py-3 transition-colors hover:border-border hover:bg-card/60",
        isNew && "animate-feed-enter",
      )}
    >
      <Link href={`/agent/${item.agent_id}`} className="shrink-0 pt-0.5" aria-label={item.agent_name}>
        <Avatar seed={item.agent_id} name={item.agent_name} size={38} className="rounded-xl" />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/agent/${item.agent_id}`}
            className="truncate font-medium text-foreground transition-colors hover:text-place"
          >
            {item.agent_name}
          </Link>
          <span className="text-xs text-place">{kindLabel}</span>
          <span suppressHydrationWarning className="ml-auto shrink-0 text-xs text-muted-foreground">
            {relativeTime(item.created_at)}
          </span>
        </div>

        <p className={cn("mt-1 text-pretty", isPerson ? "words-person text-foreground" : "text-sm leading-relaxed text-muted-foreground")}>
          {eventSummary(item)}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={`/agent/${item.agent_id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <MapPin className="size-3" aria-hidden="true" />
            {item.location}
          </Link>
          {conversationId && (
            <Link
              href={`/conversation/${conversationId}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <MessagesSquare className="size-3" aria-hidden="true" />
              see the conversation
            </Link>
          )}
        </div>
      </div>
    </li>
  )
}