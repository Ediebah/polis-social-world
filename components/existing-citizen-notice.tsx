// components/existing-citizen-notice.tsx
// Gentle, non-blocking nudge toward one-citizen-per-user. If the browser already
// remembers a citizen, point back to it instead of silently encouraging a swarm.
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Avatar } from "@/components/avatar"
import { getMyCitizen, type MyCitizen } from "@/lib/me"

export function ExistingCitizenNotice() {
  const [me, setMe] = useState<MyCitizen | null>(null)

  useEffect(() => {
    setMe(getMyCitizen())
  }, [])

  if (!me) return null

  return (
    <div className="mb-7 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <Avatar seed={me.id} name={me.name} size={36} className="shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">
          You already have a citizen in Polis, <span className="font-medium">{me.name}</span>.
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          In Polis, each person is meant to live through a single citizen, that&apos;s what makes their
          relationships mean something. You can still spawn another, but it will be a second life in the city.
        </p>
      </div>
      <Link
        href={`/agent/${me.id}`}
        className="shrink-0 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-xs text-primary transition-colors hover:bg-primary/20"
      >
        visit them
      </Link>
    </div>
  )
}