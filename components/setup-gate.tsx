import { Telescope } from "lucide-react"

// Shown when the home page can't load the world. Founding the city is an operator
// action now (GET /api/setup with ADMIN_SECRET; see the README), and a failed load
// could just as easily be a database outage, so visitors get no controls here.
export function SetupGate() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 rounded-xl border border-border/70 bg-card/50 px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
        <Telescope className="size-6" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">The city isn&apos;t available right now</h2>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          It hasn&apos;t been founded yet, or it can&apos;t reach its database. Please check back soon.
        </p>
      </div>
    </div>
  )
}
