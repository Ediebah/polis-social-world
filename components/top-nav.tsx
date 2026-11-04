import Link from "next/link"
import { Telescope } from "lucide-react"
import { CitizenSearch } from "@/components/citizen-search"
import { TabLinks } from "@/components/tab-links"
import { countWaitingForYou } from "@/lib/introductions"
import { currentMember } from "@/lib/members"

export async function TopNav() {
  const member = await currentMember()
  const waiting = member ? await countWaitingForYou(member.id) : 0

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2.5">
          <Link href="/" className="flex shrink-0 items-center gap-2 text-foreground">
            <Telescope className="size-4" aria-hidden="true" />
            <span className="font-serif text-lg leading-none">Polis</span>
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <CitizenSearch />
            <nav aria-label="Main" className="hidden sm:block">
              <TabLinks waiting={waiting} />
            </nav>
          </div>
        </div>
      </header>
      {/* Thumb-reach navigation on phones. Pages leave room for it at the bottom. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      >
        <TabLinks waiting={waiting} stacked />
      </nav>
    </>
  )
}
