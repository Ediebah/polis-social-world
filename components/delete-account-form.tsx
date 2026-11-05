"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { deleteAccountAction, type DeleteAccountState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function DeleteButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="destructive" disabled={pending} className="h-11 self-start px-4 sm:h-9">
      {pending ? "Deleting..." : "Delete everything"}
    </Button>
  )
}

export function DeleteAccountForm({ name }: { name: string }) {
  const [state, action] = useActionState<DeleteAccountState, FormData>(deleteAccountAction, {})

  return (
    <form action={action} className="flex max-w-sm flex-col gap-2">
      <Input name="confirm" required autoComplete="off" aria-label={`Type ${name} to confirm`} placeholder={`Type ${name} to confirm`} className="h-11 sm:h-9" />
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      <DeleteButton />
    </form>
  )
}
