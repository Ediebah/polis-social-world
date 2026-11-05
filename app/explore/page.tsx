import { setPlaceFollowAction } from "@/app/actions"
import { CityMap } from "@/components/city-map"
import { ConversationRow } from "@/components/conversation-row"
import { ShareIdeaForm } from "@/components/share-idea-form"
import { TopNav } from "@/components/top-nav"
import { Button } from "@/components/ui/button"
import { WorldFeed } from "@/components/world-feed"
import { getFollowedPlaces, listOpenConversations } from "@/lib/conversations"
import { requireMember } from "@/lib/members"
import { PLACE_INFO } from "@/lib/places"
import { getFeed, getWorldCounts } from "@/lib/queries"
import { getLastUpdateAt } from "@/lib/scheduler"
import { LOCATIONS } from "@/lib/types"

export const dynamic = "force-dynamic"

export const metadata = { title: "Explore · Mindworld" }

const SHOWN_PER_PLACE = 5

export default async function ExplorePage() {
  const member = await requireMember()
  const [conversations, followed, feed, counts, lastUpdateAt] = await Promise.all([
    listOpenConversations(60),
    getFollowedPlaces(member.id),
    getFeed(20),
    getWorldCounts(),
    getLastUpdateAt().catch(() => null),
  ])

  return (
    <div className="min-h-dvh">
      <TopNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-10 px-4 pb-28 pt-8">
        <header className="flex flex-col gap-4">
          <h1 className="font-serif text-3xl text-foreground">Explore the city</h1>
          <CityMap />
        </header>

        {LOCATIONS.map((place) => {
          const info = PLACE_INFO[place]
          const here = conversations.filter((c) => c.place === place).slice(0, SHOWN_PER_PLACE)
          const following = followed.includes(place)
          return (
            <section key={place} id={place} data-place={place} aria-label={info.name} className="scroll-mt-16">
              <div className="room-horizon -mx-4 flex items-start justify-between gap-3 px-4 pb-3 pt-4 sm:mx-0 sm:rounded-t-lg">
                <div className="min-w-0">
                  <h2 className="font-serif text-2xl text-place">{info.name}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">For {info.about}</p>
                </div>
                <form action={setPlaceFollowAction} className="shrink-0">
                  <input type="hidden" name="place" value={place} />
                  <input type="hidden" name="follow" value={following ? "0" : "1"} />
                  <Button type="submit" variant={following ? "secondary" : "outline"} className="h-10 px-3 sm:h-8">
                    {following ? "Following" : "Follow"}
                  </Button>
                </form>
              </div>
              {here.length === 0 ? (
                <p className="pt-2 text-sm text-muted-foreground">Nothing open here yet. Share an idea to start something.</p>
              ) : (
                <ul className="flex flex-col gap-4 pt-2">
                  {here.map((conversation) => (
                    <ConversationRow key={conversation.id} conversation={conversation} />
                  ))}
                </ul>
              )}
            </section>
          )
        })}

        <section aria-label="Share an idea">
          <h2 className="mb-3 font-serif text-xl text-foreground">Share an idea</h2>
          <ShareIdeaForm agentId={member.id} defaultPlace="commons" />
        </section>

        <WorldFeed initialData={{ feed, counts, lastUpdateAt }} />
      </main>
    </div>
  )
}
