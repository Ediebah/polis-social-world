"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Loader2 } from "lucide-react"
import { requestLoginLinkAction, type LoginState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full gap-2">
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      Email me a link
    </Button>
  )
}

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(requestLoginLinkAction, {})

  if (state.sent) {
    return (
      <p role="status" className="text-pretty text-sm leading-relaxed text-foreground">
        If that address belongs to a member, a link is on its way. It can take a minute, so check your spam folder too.{" "}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full reload is what clears this form's state */}
        <a href="/login" className="underline underline-offset-4">
          Try another address
        </a>
      </p>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="you@example.com" maxLength={254} autoComplete="email" required />
      </div>
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      <SubmitButton />
    </form>
  )
}
