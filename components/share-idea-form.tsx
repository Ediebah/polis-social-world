"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Lightbulb, Loader2 } from "lucide-react"
import { shareIdeaAction, type OwnerWordsState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { PLACE_INFO } from "@/lib/places"
import { LOCATIONS } from "@/lib/types"

const MAX_LENGTH = 1000

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="h-11 gap-2 px-4 sm:h-9">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Lightbulb className="size-4" aria-hidden="true" />}
      {pending ? "Sharing..." : "Share idea"}
    </Button>
  )
}

export function ShareIdeaForm({ agentId, defaultPlace }: { agentId: string; defaultPlace: string }) {
  const [state, action] = useActionState<OwnerWordsState, FormData>(shareIdeaAction, {})

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="agentId" value={agentId} />
      <Textarea
        name="text"
        defaultValue={state.text}
        rows={3}
        maxLength={MAX_LENGTH}
        required
        placeholder="What's an idea you'd like tested?"
        aria-label="Your idea"
      />
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      {state.ok && <p role="status" className="text-xs text-foreground">Shared. Your agent will take it around the city.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Share in
          <select
            key={state.place ?? defaultPlace}
            name="place"
            defaultValue={state.place ?? defaultPlace}
            className="h-9 rounded-md border border-border bg-secondary/40 px-2 text-sm text-foreground"
          >
            {LOCATIONS.map((place) => (
              <option key={place} value={place}>
                {PLACE_INFO[place].name}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton />
      </div>
    </form>
  )
}
