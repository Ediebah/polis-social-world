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
    <Button type="submit" size="sm" disabled={pending} className="h-11 gap-2 self-end px-4 sm:h-9">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
      {pending ? "Posting..." : "Post your words"}
    </Button>
  )
}

export function AddWordsForm({ conversationId, agentId }: { conversationId: string; agentId: string }) {
  const [state, action] = useActionState<OwnerWordsState, FormData>(addWordsAction, {})

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="agentId" value={agentId} />
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
