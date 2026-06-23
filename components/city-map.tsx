"use client"

import { useEffect, useState } from "react"
import { Anchor, Hammer, Landmark, Sprout, Store, Telescope } from "lucide-react"
import { cn } from "@/lib/utils"

type District = { name: string; count: number }

const META: Record<string, { icon: React.ReactNode; accent: string }> = {
  plaza: { icon: <Landmark className="size-4" aria-hidden />, accent: "text-primary" },
  market: { icon: <Store className="size-4" aria-hidden />, accent: "text-emerald-300" },
  harbor: { icon: <Anchor className="size-4" aria-hidden />, accent: "text-sky-300" },
  observatory: { icon: <Telescope className="size-4" aria-hidden />, accent: "text-violet-300" },
  gardens: { icon: <Sprout className="size-4" aria-hidden />, accent: "text-lime-300" },
  foundry: { icon: <Hammer className="size-4" aria-hidden />, accent: "text-amber-300" },
}

export function CityMap({ pollMs = 5000 }: { pollMs?: number }) {
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

  const max = Math.max(1, ...districts.map((d) => d.count))

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">the city</h2>
        <span className="font-mono text-xs text-muted-foreground">
          {total} {total === 1 ? "citizen" : "citizens"} across six districts
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {districts.map((d) => {
          const meta = META[d.name] ?? { icon: null, accent: "text-muted-foreground" }
          const intensity = d.count / max
          return (
            <div
              key={d.name}
              className="relative overflow-hidden rounded-xl border border-border/70 bg-card/50 px-4 py-3.5"
            >
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 bg-primary/10 transition-[height] duration-700"
                style={{ height: `${Math.round(intensity * 100)}%` }}
                aria-hidden
              />
              <div className="relative">
                <span
                  className={cn(
                    "flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em]",
                    meta.accent,
                  )}
                >
                  {meta.icon}
                  {d.name}
                </span>
                <div className="mt-2 flex items-end justify-between">
                  <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{d.count}</span>
                  <div className="flex max-w-[60%] flex-wrap justify-end gap-1">
                    {Array.from({ length: Math.min(d.count, 12) }).map((_, i) => (
                      <span key={i} className="size-1.5 rounded-full bg-foreground/55" aria-hidden />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}