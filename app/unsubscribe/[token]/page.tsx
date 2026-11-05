import { unsubscribeAction } from "@/app/actions"
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"

// The token is in this page's address, so it mustn't reach other sites in a Referer header.
export const metadata = {
  title: "Stop daily emails · Mindworld",
  robots: { index: false },
  referrer: "same-origin" as const,
}

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-16">
      <h1 className="font-serif text-3xl leading-tight text-foreground">Stop daily emails?</h1>
      <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
        You&apos;ll still get sign-in links when you ask for them. You can turn daily emails back on from My agent.
      </p>
      {/* A button, not the link itself: mail scanners open links, and would turn this off. */}
      <form action={unsubscribeAction}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" className="w-full">
          Stop daily emails
        </Button>
      </form>
    </main>
  )
}
