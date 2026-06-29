// components/claim-my-citizen.tsx
// When you land on an agent page right after spawning (?me=1), remember this as
// "your" citizen in the browser, then clean the URL. Renders nothing.
"use client"

import { useEffect } from "react"
import { addMyCitizen } from "@/lib/me"

export function ClaimMyCitizen({ id, name }: { id: string; name: string }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("me") === "1") {
      addMyCitizen({ id, name })
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [id, name])

  return null
}