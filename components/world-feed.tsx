"use client"

import { useEffect, useRef, useState } from "react"
import useSWR from "swr"
import type { FeedItem, WorldCounts } from "@/lib/types"
import { FeedRow } from "./feed-row"
import { cn } from "@/lib/utils"

interface FeedResponse {
  feed: FeedItem[]
  counts: WorldCounts
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">
        {value.toLocaleString()}
      </span>
    </div>
  )
}

export function WorldFeed({ initialData }: { initialData: FeedResponse }) {
  const { data } = useSWR<FeedResponse>("/api/feed", fetcher, {
    refreshInterval: 4000,
    fallbackData: initialData,
    revalidateOnFocus: true,
  })

  const feed = data?.feed ?? []
  const counts = data?.counts ?? { population: 0, total_actions: 0 }

  // Track which items are newly arrived so we can animate only those.
  const seenRef = useRef<Set<string>>(new Set(initialData.feed.map((i) => i.id)))
  const [newIds, setNewIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const fresh = new Set<string>()
    for (const item of feed) {
      if (!seenRef.current.has(item.id)) {
        fresh.add(item.id)
        seenRef.current.add(item.id)
      }
    }
    if (fresh.size > 0) setNewIds(fresh)
  }, [feed])

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="World status"
        className="flex items-end justify-between gap-6 rounded-xl border border-border/70 bg-card/50 px-5 py-5"
      >
        <Counter label="Population" value={counts.population} />
        <Counter label="Total actions" value={counts.total_actions} />
        <div className="ml-auto flex items-center gap-2 self-start">
          <span className="size-2 animate-pulse-dot rounded-full bg-primary" aria-hidden="true" />
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">live</span>
        </div>
      </section>

      <section aria-label="World feed">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">The world, as it happens</h2>
          <span className="font-mono text-[11px] text-muted-foreground">refreshes every 4s</span>
        </div>

        {feed.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            The world is quiet. No one has stirred yet.
          </p>
        ) : (
          <ul className={cn("flex flex-col")}>
            {feed.map((item) => (
              <FeedRow key={item.id} item={item} isNew={newIds.has(item.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
