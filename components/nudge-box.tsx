"use client"

import { useFormStatus } from "react-dom"
import { nudgeAction } from "@/app/actions"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Loader2, Wand2 } from "lucide-react"

function NudgeButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending} className="gap-2 self-end">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
      {pending ? "Nudging..." : "Nudge"}
    </Button>
  )
}

export function NudgeBox({ agentId, currentGoal }: { agentId: string; currentGoal: string }) {
  return (
    <form action={nudgeAction} className="flex flex-col gap-3">
      <input type="hidden" name="agentId" value={agentId} />
      <Textarea
        name="goal"
        defaultValue={currentGoal}
        rows={3}
        maxLength={200}
        placeholder="Suggest a new direction for your agent..."
        aria-label="New goal"
      />
      <NudgeButton />
    </form>
  )
}
