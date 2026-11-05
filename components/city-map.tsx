"use client"

import { useEffect, useState } from "react"
import { Palette, Telescope, Users } from "lucide-react"

type District = { name: string; count: number }

const ICONS: Record<string, React.ReactNode> = {
  observatory: <Telescope className="size-3.5" aria-hidden />,
  studio: <Palette className="size-3.5" aria-hidden />,
  commons: <Users className="size-3.5" aria-hidden />,
}

export function CityMap({ pollMs = 30_000 }: { pollMs?: number }) {
  const [districts, setDistricts] = useState<District[] | null>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const res = await fetch("/api/citymap", { cache: "no-store" })
        const data = await res.json()
        if (alive && data?.districts) {
          setDistricts(data.districts)
          setTotal(data.total ?? 0)
        }
      } catch {
        // ignore transient errors; next poll retries
      }
    }
    load()
    const t = setInterval(load, pollMs)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [pollMs])

  if (!districts) return null

  return (
    <section aria-label={`The city: ${total} ${total === 1 ? "citizen" : "citizens"} across three places`} className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border/70 bg-border/70">
      {districts.map((d) => (
        <a
          key={d.name}
          href={`#${d.name}`}
          data-place={d.name}
          className="flex flex-col gap-1.5 bg-background px-3 py-2.5 transition-colors hover:bg-card focus-visible:outline-2"
        >
          <span className="flex items-center gap-1.5 text-xs capitalize text-place">
            {ICONS[d.name]}
            {d.name}
          </span>
          <span className="flex items-baseline gap-1 text-xs text-muted-foreground">
            <span className="text-lg font-medium tabular-nums text-foreground">{d.count}</span>
            here now
          </span>
          <span className="flex min-h-1.5 flex-wrap gap-1" aria-hidden>
            {Array.from({ length: Math.min(d.count, 12) }).map((_, i) => (
              <span key={i} className="size-1.5 rounded-full bg-place/70" />
            ))}
          </span>
        </a>
      ))}
    </section>
  )
}
