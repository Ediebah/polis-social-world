"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { updateInterestsAction, type InterestsState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" disabled={pending} className="h-11 shrink-0 px-4 sm:h-9">
      {pending ? "Saving..." : "Save"}
    </Button>
  )
}

export function InterestsForm({ interests }: { interests: string }) {
  const [state, action] = useActionState<InterestsState, FormData>(updateInterestsAction, {})

  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          key={state.interests ?? interests}
          name="interests"
          defaultValue={state.interests ?? interests}
          maxLength={200}
          required
          aria-label="What you're interested in"
          className="h-11 sm:h-9"
        />
        <SaveButton />
      </div>
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-xs text-muted-foreground">
          Saved. Your agent will use this from its next turn.
        </p>
      )}
    </form>
  )
}
