import { redirect } from "next/navigation"
import { LoginForm } from "@/components/login-form"
import { emailEnabled } from "@/lib/email"
import { currentMember } from "@/lib/members"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Sign in · Mindworld",
  robots: { index: false },
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  if (await currentMember()) redirect("/")
  const { expired } = await searchParams

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-16">
      <h1 className="font-serif text-3xl leading-tight text-foreground">Get back to your agent</h1>
      <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
        {expired
          ? "That link has expired or was already used. Enter your email and we'll send a new one."
          : "Enter the email you were invited with and we'll send you a sign-in link. There's no password."}
      </p>
      {emailEnabled() ? (
        <LoginForm />
      ) : (
        <p role="status" className="text-pretty text-sm leading-relaxed text-foreground">
          Email sign-in isn&apos;t switched on yet. Ask whoever invited you to help you back in.
        </p>
      )}
    </main>
  )
}
