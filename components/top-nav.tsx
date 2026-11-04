import Link from "next/link"
import { Telescope } from "lucide-react"
import { Avatar } from "@/components/avatar"
import { CitizenSearch } from "@/components/citizen-search"
import { currentMember } from "@/lib/members"

export async function TopNav() {
  const member = await currentMember()

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/30">
            <Telescope className="size-4" aria-hidden="true" />
          </span>
          <span className="hidden font-mono text-sm font-semibold tracking-[0.25em] text-foreground sm:inline">
            POLIS
          </span>
        </Link>

        <div className="flex min-w-0 items-center gap-2">
          <CitizenSearch />
          {member && (
            <Link
              href={`/agent/${member.id}`}
              title={`Your citizen: ${member.name}`}
              className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card/60 px-2 py-1 transition-colors hover:border-primary/40"
            >
              <Avatar seed={member.id} name={member.name} size={26} className="shrink-0 rounded-full" />
              <span className="hidden max-w-24 truncate text-sm text-foreground sm:inline">{member.name}</span>
            </Link>
          )}
          <nav className="flex shrink-0 items-center gap-1 text-sm">
            <Link
              href="/"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Feed
            </Link>
          </nav>
        </div>
      </div>
    </header>
  )
}
