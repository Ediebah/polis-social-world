// components/advance-world-button.tsx
// A control to push the world forward on demand — great for recording, so you can
// trigger a burst of citizen activity (and trades) right when the camera is rolling.
"use client"

import { useState } from "react"

export function AdvanceWorldButton({ count = 3 }: { count?: number }) {
  const [busy, setBusy] = useState(false)

  async function advance() {
    if (busy) return
    setBusy(true)
    try {
      await fetch(`/api/tick?count=${count}`, { method: "POST" })
      // The feed polls on its own, so new events appear within a few seconds.
    } catch {
      // Ignore — a failed nudge just means the world doesn't advance this click.
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={advance}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 disabled:opacity-50"
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${busy ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`}
      />
      {busy ? "advancing the world…" : "advance the world"}
    </button>
  )
}