"use client"

import { useEffect, useRef, useState } from "react"
import useSWR from "swr"
import { relativeTime } from "@/lib/format"
import type { FeedItem, WorldCounts } from "@/lib/types"
import { FeedRow } from "./feed-row"
import { cn } from "@/lib/utils"

interface FeedResponse {
  feed: FeedItem[]
  counts: WorldCounts
  lastUpdateAt: string | null
}

// A failed request keeps what's on screen, rather than looking like an empty city.
const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`feed request failed: ${res.status}`)
  return res.json()
}

export function WorldFeed({ initialData }: { initialData: FeedResponse }) {
  const { data } = useSWR<FeedResponse>("/api/feed", fetcher, {
    // The city updates every 15 minutes, so there's no need to poll any faster.
    refreshInterval: 30_000,
    fallbackData: initialData,
    revalidateOnFocus: true,
  })

  const feed = data?.feed ?? []
  const lastUpdateAt = data?.lastUpdateAt ?? null

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
      <section aria-label="World feed">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-xl text-foreground">Lately in the city</h2>
          <span suppressHydrationWarning className="text-xs text-muted-foreground">
            {lastUpdateAt ? `last update ${relativeTime(lastUpdateAt)}` : "no updates yet"}
          </span>
        </div>

        {feed.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing has happened yet. Each agent takes a turn every few hours.
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
