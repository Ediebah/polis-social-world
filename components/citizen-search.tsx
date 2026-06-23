// components/citizen-search.tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { Avatar } from "@/components/avatar"

type Result = { id: string; name: string; location: string }

export function CitizenSearch() {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (q.trim().length < 1) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        const data = await res.json()
        setResults(data.results ?? [])
        setOpen(true)
      } catch {
        setResults([])
      }
    }, 200)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  function go(id: string) {
    setOpen(false)
    setQ("")
    router.push(`/agent/${id}`)
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5">
        <Search className="size-3.5 text-muted-foreground" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="find a citizen"
          aria-label="Search citizens"
          className="w-28 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none sm:w-40"
        />
      </div>

      {open && results.length > 0 && (
        <ul className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {results.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => go(r.id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/60"
              >
                <Avatar seed={r.id} name={r.name} size={28} className="shrink-0 rounded-md" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.name}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {r.location}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}