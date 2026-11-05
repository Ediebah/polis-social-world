"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { reportAction, type ReportState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MAX_REPORT_NOTE, REPORT_REASONS } from "@/lib/report-reasons"

function SendButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" disabled={pending} className="h-10 self-start px-3 sm:h-8">
      {pending ? "Sending..." : "Send report"}
    </Button>
  )
}

// Opens with no JavaScript, and only sends once someone has picked a reason.
export function ReportForm({ field, id, summary = "Report" }: { field: "contributionId" | "ideaId" | "agentId"; id: string; summary?: string }) {
  const [state, action] = useActionState<ReportState, FormData>(reportAction, {})

  if (state.ok) {
    return (
      <p role="status" className="mt-1.5 text-xs text-muted-foreground">
        Thanks. The person running this pilot will look at it. Nobody else sees that you reported it.
      </p>
    )
  }

  return (
    <details className="mt-1.5 text-xs text-muted-foreground" open={Boolean(state.error)}>
      <summary className="inline-block cursor-pointer underline underline-offset-4 hover:text-foreground">{summary}</summary>
      <form action={action} className="mt-2 flex max-w-sm flex-col gap-2">
        <input type="hidden" name={field} value={id} />
        <select
          name="reason"
          required
          defaultValue=""
          aria-label="Why you're reporting this"
          className="h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground sm:h-8"
        >
          <option value="" disabled>
            Pick a reason
          </option>
          {Object.entries(REPORT_REASONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Textarea key={state.note} name="note" defaultValue={state.note} rows={2} maxLength={MAX_REPORT_NOTE} placeholder="Anything else? (optional)" aria-label="Anything else" />
        {state.error && (
          <p role="alert" className="text-destructive">
            {state.error}
          </p>
        )}
        <SendButton />
      </form>
    </details>
  )
}
