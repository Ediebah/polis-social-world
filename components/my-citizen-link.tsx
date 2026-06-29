"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import { Avatar } from "@/components/avatar"
import { getMyCitizens, type MyCitizen } from "@/lib/me"

export function MyCitizenLink() {
  const [citizens, setCitizens] = useState<MyCitizen[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCitizens(getMyCitizens())
  }, [])

  // Close the dropdown on any click outside of it.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [open])

  if (citizens.length === 0) return null

  // getMyCitizens() is newest-first, so the most recent citizen is at index 0.
  const latest = citizens[0]

  // Exactly one remembered citizen: the original single avatar link, unchanged.
  if (citizens.length === 1) {
    return (
      <Link
        href={`/agent/${latest.id}`}
        title={`Your citizen: ${latest.name}`}
        className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-2 py-1 transition-colors hover:border-primary/40"
      >
        <Avatar seed={latest.id} name={latest.name} size={26} className="shrink-0 rounded-full" />
        <span className="hidden max-w-24 truncate text-sm text-foreground sm:inline">{latest.name}</span>
      </Link>
    )
  }

  // Two or more: avatar + count badge that opens a menu of all remembered citizens.
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Your citizens"
        aria-label={`Your citizens (${citizens.length})`}
        aria-expanded={open ? "true" : "false"}
        className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 py-1 pl-1 pr-2 transition-colors hover:border-primary/40"
      >
        <span className="relative shrink-0">
          <Avatar seed={latest.id} name={latest.name} size={26} className="rounded-full" />
          <span className="absolute -bottom-1 -right-1 flex min-w-4 items-center justify-center rounded-full border border-background bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
            {citizens.length}
          </span>
        </span>
        <ChevronDown
          className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 max-h-80 w-56 overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg shadow-black/20">
          {citizens.map((c) => (
            <Link
              key={c.id}
              href={`/agent/${c.id}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary"
            >
              <Avatar seed={c.id} name={c.name} size={24} className="shrink-0 rounded-full" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.name}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
