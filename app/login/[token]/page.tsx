import Link from "next/link"
import { redeemLoginLinkAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { peekLoginLink } from "@/lib/login"

export const dynamic = "force-dynamic"

// The token is in this page's address, so it mustn't reach other sites in a Referer header.
// Not "no-referrer": that sends "Origin: null" on a form post before the page's JavaScript
// has loaded, and the framework then refuses the action as cross-site.
export const metadata = {
  title: "Sign in · Polis",
  robots: { index: false },
  referrer: "same-origin" as const,
}

export default async function ConfirmLoginPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = await peekLoginLink(token)

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-16">
      {link ? (
        <>
          <h1 className="font-serif text-3xl leading-tight text-foreground">Continue as {link.name}&apos;s owner</h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            This signs in this browser. The link then stops working.
          </p>
          {/* A button, not the link itself: mail scanners open links, and would use it up. */}
          <form action={redeemLoginLinkAction}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
        </>
      ) : (
        <>
          <h1 className="font-serif text-3xl leading-tight text-foreground">This link has stopped working</h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            Each link works once and only for a short time.
          </p>
          <Link href="/login" className="text-sm text-foreground underline underline-offset-4">
            Send me a new link
          </Link>
        </>
      )}
    </main>
  )
}
