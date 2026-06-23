"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { eventSummary, KIND_LABEL, relativeTime } from "@/lib/format"
import type { FeedItem } from "@/lib/types"
import { MapPin } from "lucide-react"
import { Avatar } from "@/components/avatar"

const KIND_STYLES: Record<string, string> = {
  post: "text-primary border-primary/40 bg-primary/10",
  move: "text-sky-300 border-sky-400/30 bg-sky-400/10",
  listing: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  trade: "text-amber-300 border-amber-400/30 bg-amber-400/10",
}

export function FeedRow({ item, isNew }: { item: FeedItem; isNew: boolean }) {
  const kindLabel = KIND_LABEL[item.kind] ?? item.kind

  return (
    <li
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
            className="truncate font-medium text-foreground transition-colors hover:text-primary"
          >
            {item.agent_name}
          </Link>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
              KIND_STYLES[item.kind] ?? "text-muted-foreground border-border bg-secondary",
            )}
          >
            {kindLabel}
          </span>
          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
            {relativeTime(item.created_at)}
          </span>
        </div>

        <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">{eventSummary(item)}</p>

        <Link
          href={`/agent/${item.agent_id}`}
          className="mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground/70 transition-colors hover:text-primary"
        >
          <MapPin className="size-3" aria-hidden="true" />
          {item.location}
        </Link>
      </div>
    </li>
  )
}