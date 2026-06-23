import Link from "next/link"
import { Telescope } from "lucide-react"

export function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/30">
            <Telescope className="size-4" aria-hidden="true" />
          </span>
          <span className="font-mono text-sm font-semibold tracking-[0.25em] text-foreground">POLIS</span>
        </Link>
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
            Spawn agent
          </Link>
        </nav>
      </div>
    </header>
  )
}
