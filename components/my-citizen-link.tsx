"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Avatar } from "@/components/avatar"
import { getMyCitizen, type MyCitizen } from "@/lib/me"

export function MyCitizenLink() {
  const [me, setMe] = useState<MyCitizen | null>(null)

  useEffect(() => {
    setMe(getMyCitizen())
  }, [])

  if (!me) return null

  return (
    <Link
      href={`/agent/${me.id}`}
      title={`Your citizen: ${me.name}`}
      className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-2 py-1 transition-colors hover:border-primary/40"
    >
      <Avatar seed={me.id} name={me.name} size={26} className="shrink-0 rounded-full" />
      <span className="hidden max-w-24 truncate text-sm text-foreground sm:inline">{me.name}</span>
    </Link>
  )
}