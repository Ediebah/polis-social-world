"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { spawnAgentAction, type SpawnState } from "@/app/actions"
import { LOCATIONS, TRAIT_OPTIONS } from "@/lib/types"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Loader2, Sparkles } from "lucide-react"

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled} className="w-full gap-2">
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {pending ? "Breathing life into the city..." : "Spawn into Polis"}
    </Button>
  )
}

export function SpawnForm() {
  const [state, formAction] = useActionState<SpawnState, FormData>(spawnAgentAction, {})
  const [traits, setTraits] = useState<string[]>([])
  const [location, setLocation] = useState<string>("plaza")

  function toggleTrait(t: string) {
    setTraits((prev) => {
      if (prev.includes(t)) return prev.filter((x) => x !== t)
      if (prev.length >= 5) return prev
      return [...prev, t]
    })
  }

  const traitsValid = traits.length >= 3 && traits.length <= 5

  return (
    <form action={formAction} className="flex flex-col gap-7">
      {traits.map((t) => (
        <input key={t} type="hidden" name="traits" value={t} />
      ))}
      <input type="hidden" name="location" value={location} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" placeholder="e.g. Vela Marsh" maxLength={60} autoComplete="off" required />
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <Label>Personality traits</Label>
          <span
            className={cn(
              "font-mono text-xs",
              traitsValid ? "text-primary" : "text-muted-foreground",
            )}
          >
            {traits.length}/5 · pick 3–5
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {TRAIT_OPTIONS.map((t) => {
            const active = traits.includes(t)
            const locked = !active && traits.length >= 5
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTrait(t)}
                disabled={locked}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  locked && "cursor-not-allowed opacity-40 hover:border-border hover:text-muted-foreground",
                )}
              >
                {t}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="backstory">Backstory</Label>
        <Textarea
          id="backstory"
          name="backstory"
          placeholder="Where do they come from? What shaped them?"
          rows={3}
          maxLength={500}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="goal">Starting goal</Label>
        <Input
          id="goal"
          name="goal"
          placeholder="What do they want, more than anything?"
          maxLength={200}
          autoComplete="off"
          required
        />
      </div>

      <div className="flex flex-col gap-2.5">
        <Label>Starting location</Label>
        <div className="flex flex-wrap gap-2">
          {LOCATIONS.map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => setLocation(loc)}
              aria-pressed={location === loc}
              className={cn(
                "rounded-md border px-3 py-1.5 font-mono text-xs capitalize transition-colors",
                location === loc
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {loc}
            </button>
          ))}
        </div>
      </div>

      {state.error && (
        <p className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <SubmitButton disabled={!traitsValid} />
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Sparkles className="size-3" aria-hidden="true" />
          Your agent begins with a balance of 1,000 and will live on its own.
        </p>
      </div>
    </form>
  )
}
