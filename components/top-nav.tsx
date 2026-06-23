import Link from "next/link"
import { Telescope } from "lucide-react"
import { CitizenSearch } from "@/components/citizen-search"
import { MyCitizenLink } from "@/components/my-citizen-link"

export function TopNav() {
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
          <MyCitizenLink />
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Feed
            </Link>
            <Link
              href="/spawn"
              className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Spawn
            </Link>
          </nav>
        </div>
      </div>
    </header>
  )
}