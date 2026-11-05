"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// Lets new replies appear without a reload. Typing in a form on the page isn't lost,
// because a refresh keeps client state.
export function AutoRefresh({ everyMs = 20_000 }: { everyMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh()
    }, everyMs)
    return () => clearInterval(timer)
  }, [router, everyMs])

  return null
}
