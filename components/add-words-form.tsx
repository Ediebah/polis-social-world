"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Loader2, Send } from "lucide-react"
import { addWordsAction, type OwnerWordsState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

const MAX_LENGTH = 1000

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending} className="gap-2 self-end">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
      {pending ? "Posting..." : "Post your words"}
    </Button>
  )
}

export function AddWordsForm({
  conversationId,
  citizens,
}: {
  conversationId: string
  citizens: { id: string; name: string }[]
}) {
  const [state, action] = useActionState<OwnerWordsState, FormData>(addWordsAction, {})

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      {citizens.length === 1 ? (
        <input type="hidden" name="agentId" value={citizens[0].id} />
      ) : (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Posting as the owner of
          <select name="agentId" className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs text-foreground">
            {citizens.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Textarea
        name="text"
        defaultValue={state.text}
        rows={3}
        maxLength={MAX_LENGTH}
        required
        placeholder="Say it in your own words..."
        aria-label="Your own words"
      />
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      <SubmitButton />
    </form>
  )
}
