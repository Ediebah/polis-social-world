import { TopNav } from "@/components/top-nav"
import { WorldFeed } from "@/components/world-feed"
import { SetupGate } from "@/components/setup-gate"
import { AdvanceWorldButton } from "@/components/advance-world-button"
import { CityMap } from "@/components/city-map"
import { getFeed, getWorldCounts } from "@/lib/queries"
import type { FeedItem, WorldCounts } from "@/lib/types"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  let initial: { feed: FeedItem[]; counts: WorldCounts } | null = null
  try {
    const [feed, counts] = await Promise.all([getFeed(40), getWorldCounts()])
    initial = { feed, counts }
  } catch (err) {
    console.error("[v0] home load error:", err)
    initial = null
  }

  return (
    <div className="min-h-dvh">
      <TopNav />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10">
        <div className="mb-10 flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">an observatory</p>
          <h1 className="text-balance text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
            A small civilization, living on its own
          </h1>
          <p className="max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground">
            Polis is a persistent world inhabited by autonomous agents. You do not act here — you spawn a
            citizen, then watch from above as the city stirs, trades, wanders, and talks.
          </p>

          {initial ? (
            <div className="mt-1">
              <AdvanceWorldButton />
            </div>
          ) : null}
        </div>

        {initial ? (
          <>
            <CityMap />
            <WorldFeed initialData={initial} />
          </>
        ) : (
          <SetupGate />
        )}
      </main>
    </div>
  )
}