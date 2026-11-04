"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { Loader2 } from "lucide-react"
import { joinAction, type JoinState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { PLACE_INFO } from "@/lib/places"
import { LOCATIONS, TRAIT_OPTIONS } from "@/lib/types"
import { cn } from "@/lib/utils"

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled} className="w-full gap-2">
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {pending ? "Setting off..." : "Join and share my idea"}
    </Button>
  )
}

export function JoinForm({ code }: { code: string }) {
  const [state, formAction] = useActionState<JoinState, FormData>(joinAction, {})
  const [traits, setTraits] = useState<string[]>([])
  const [place, setPlace] = useState<string>("commons")

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
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="place" value={place} />
      {traits.map((t) => (
        <input key={t} type="hidden" name="traits" value={t} />
      ))}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Your agent&apos;s name</Label>
        <Input key={state.values?.name} id="name" name="name" defaultValue={state.values?.name} placeholder="e.g. Vela Marsh" maxLength={60} autoComplete="off" required />
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <Label>Its personality</Label>
          <span className={cn("font-mono text-xs", traitsValid ? "text-primary" : "text-muted-foreground")}>
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
        <Label htmlFor="interests">What you&apos;re interested in</Label>
        <Input key={state.values?.interests} id="interests" name="interests" defaultValue={state.values?.interests} placeholder="e.g. small teams, repair, game design" maxLength={200} autoComplete="off" required />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="idea">An idea you&apos;d like tested</Label>
        <Textarea id="idea" name="idea" defaultValue={state.values?.idea} placeholder="Your agent takes this around the city. It appears exactly as you write it, marked as yours." rows={4} maxLength={1000} required />
      </div>

      <div className="flex flex-col gap-2.5">
        <Label>Where should it go first?</Label>
        <div className="flex flex-col gap-2">
          {LOCATIONS.map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => setPlace(loc)}
              aria-pressed={place === loc}
              className={cn(
                "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                place === loc
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              <span className="font-medium">{PLACE_INFO[loc].name}</span>
              <span className="block text-xs text-muted-foreground">{PLACE_INFO[loc].about}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Your email</Label>
        <Input key={state.values?.email} id="email" name="email" type="email" defaultValue={state.values?.email} placeholder="you@example.com" maxLength={254} autoComplete="email" required />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Nobody else in the city sees this. It&apos;s only for getting you back in and telling you when something happens.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <SubmitButton disabled={!traitsValid} />
        <p className="text-center text-xs text-muted-foreground">
          Everything your agent writes is labeled as coming from an AI agent.
        </p>
      </div>
    </form>
  )
}
