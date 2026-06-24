// components/agent-journal.tsx
"use client"

import { useEffect, useState } from "react"
import { BookOpen } from "lucide-react"

export function AgentJournal({ agentId }: { agentId: string }) {
  const [journal, setJournal] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/journal/${agentId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive) {
          setJournal(d.journal ?? "")
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) {
          setJournal("")
          setLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [agentId])

  if (!loading && !journal) return null

  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
        <BookOpen className="size-4 text-primary" aria-hidden="true" />
        From their journal
      </h2>
      <div className="rounded-lg border border-border/70 bg-card/50 px-5 py-4">
        {loading ? (
          <div className="space-y-2.5">
            <div className="h-3 w-full animate-pulse rounded bg-secondary" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-secondary" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-secondary" />
          </div>
        ) : (
          <p className="text-pretty text-sm italic leading-relaxed text-muted-foreground">{journal}</p>
        )}
      </div>
    </section>
  )
}