"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Telescope } from "lucide-react"

export function SetupGate() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function initialize() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/setup")
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? "Setup failed")
      window.location.reload()
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 rounded-xl border border-border/70 bg-card/50 px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
        <Telescope className="size-6" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">The world has not been founded</h2>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          Initialize Polis to create the database tables and seed its first citizens.
        </p>
      </div>
      <Button onClick={initialize} disabled={loading} className="gap-2">
        {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {loading ? "Founding the city..." : "Found the city"}
      </Button>
      {error && <p className="font-mono text-xs text-destructive">{error}</p>}
    </div>
  )
}
