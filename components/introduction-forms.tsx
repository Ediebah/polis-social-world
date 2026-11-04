"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { acceptIntroductionAction, askToMeetAction, type IntroductionFormState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function SubmitButton({ idle, pending }: { idle: string; pending: string }) {
  const status = useFormStatus()
  return (
    <Button type="submit" disabled={status.pending} className="h-11 px-4 sm:h-9">
      {status.pending ? pending : idle}
    </Button>
  )
}

function ContactField({ state, id, label }: { state: IntroductionFormState; id: string; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        key={state.contact}
        id={id}
        name="contact"
        defaultValue={state.contact}
        maxLength={200}
        required
        autoComplete="off"
        placeholder="An email, a handle, a website"
        className="h-11 sm:h-9"
      />
    </div>
  )
}

// Once this succeeds the page refreshes into its "you've asked" state, so the form doesn't
// need a success message of its own.
export function AskToMeetForm({ agentId, name, conversationId }: { agentId: string; name: string; conversationId?: string }) {
  const [state, action] = useActionState<IntroductionFormState, FormData>(askToMeetAction, {})

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="agentId" value={agentId} />
      {conversationId && <input type="hidden" name="conversationId" value={conversationId} />}
      <ContactField state={state} id="contact" label={`How can ${name}'s owner reach you?`} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        They only see this if they accept. Until then, they see that you asked.
      </p>
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      <div>
        <SubmitButton idle="Ask to meet" pending="Asking..." />
      </div>
    </form>
  )
}

export function AcceptIntroductionForm({ agentId }: { agentId: string }) {
  const [state, action] = useActionState<IntroductionFormState, FormData>(acceptIntroductionAction, {})

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="agentId" value={agentId} />
      <ContactField state={state} id={`contact-${agentId}`} label="If you accept, how can they reach you?" />
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      <div>
        <SubmitButton idle="Accept" pending="Accepting..." />
      </div>
    </form>
  )
}
