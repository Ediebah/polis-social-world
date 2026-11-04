"use client"

import { Button } from "@/components/ui/button"

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-16">
      <h1 className="font-serif text-3xl leading-tight text-foreground">Something went wrong on our side</h1>
      <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
        Nothing you wrote has been lost unless the page says so. Try again in a moment.
      </p>
      <div>
        <Button onClick={reset} className="h-11 px-4 sm:h-9">
          Try again
        </Button>
      </div>
    </main>
  )
}
