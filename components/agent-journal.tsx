// components/agent-journal.tsx
"use client"

import { useEffect, useState } from "react"
import { BookOpen, ChevronDown, Loader2, Volume2 } from "lucide-react"
import { relativeTime } from "@/lib/format"

export function AgentJournal({ agentId }: { agentId: string }) {
  const [journal, setJournal] = useState<string | null>(null)
  const [lastEventAt, setLastEventAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [speaking, setSpeaking] = useState(false)
  // Collapsed by default so the journal stays compact; one tap reveals it.
  const [collapsed, setCollapsed] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/journal/${agentId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive) {
          setJournal(d.journal ?? "")
          setLastEventAt(d.lastEventAt ?? null)
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

  // Read the entry aloud via Amazon Polly (/api/speak), falling back to the
  // browser's speech synthesis if Polly is unavailable.
  async function speak(text: string) {
    if (!text || speaking) return
    setSpeaking(true)
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, id: agentId }),
      })
      if (!res.ok) throw new Error("tts unavailable")
      const blob = await res.blob()
      if (!blob.size) throw new Error("empty audio")
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch {
      try {
        const synth = window.speechSynthesis
        if (synth) {
          synth.cancel()
          synth.speak(new SpeechSynthesisUtterance(text))
        }
      } catch {
        // ignore — the entry text stays visible
      }
    } finally {
      setSpeaking(false)
    }
  }

  if (!loading && !journal) return null

  const dateline = lastEventAt ? relativeTime(lastEventAt) : null

  return (
    <section className="mt-8">
      <h2 className="mb-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={collapsed ? "false" : "true"}
          className="group flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-foreground"
        >
          <span className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" aria-hidden="true" />
            From their journal
          </span>
          <span className="flex items-center gap-2">
            {dateline ? (
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{dateline}</span>
            ) : null}
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform group-hover:text-foreground ${collapsed ? "" : "rotate-180"}`}
              aria-hidden="true"
            />
          </span>
        </button>
      </h2>
      {!collapsed ? (
        <div className="rounded-lg border border-border/70 bg-card/50 px-5 py-4">
          {loading ? (
            <div className="space-y-2.5">
              <div className="h-3 w-full animate-pulse rounded bg-secondary" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-secondary" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-secondary" />
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <p className="min-w-0 flex-1 text-pretty text-sm italic leading-relaxed text-muted-foreground">
                {journal}
              </p>
              <button
                type="button"
                onClick={() => journal && speak(journal)}
                disabled={speaking}
                aria-label="Listen to this entry"
                title="Listen"
                className="shrink-0 rounded-md border border-border bg-secondary/40 p-1.5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              >
                {speaking ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Volume2 className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
