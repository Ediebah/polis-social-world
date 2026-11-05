import Link from "next/link"
import { redeemLoginLinkAction } from "@/app/actions"
import { Button, buttonVariants } from "@/components/ui/button"
import { peekLoginLink } from "@/lib/login"
import { currentMember } from "@/lib/members"

export const dynamic = "force-dynamic"

// The token is in this page's address, so it mustn't reach other sites in a Referer header.
// Not "no-referrer": that sends "Origin: null" on a form post before the page's JavaScript
// has loaded, and the framework then refuses the action as cross-site.
export const metadata = {
  title: "Sign in · Mindworld",
  robots: { index: false },
  referrer: "same-origin" as const,
}

export default async function ConfirmLoginPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = await peekLoginLink(token)
  // Anyone can forward their own link, and following it would quietly swap whose citizen
  // this browser is using. Links can't be tied to the browser that asked for them, because
  // asking on a phone and opening the email on a laptop has to work.
  const current = await currentMember()
  const replacing = link && current && current.id !== link.id ? current : null

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-16">
      {link && replacing ? (
        <>
          <h1 className="font-serif text-3xl leading-tight text-foreground">
            This link is for {link.name}&apos;s owner
          </h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            You&apos;re signed in as {replacing.name}&apos;s owner. If you didn&apos;t ask for this link, someone else
            may have sent you theirs, so stay as you are.
          </p>
          <div className="flex flex-col gap-3">
            <Link href="/" className={buttonVariants({ className: "w-full" })}>
              Stay as {replacing.name}&apos;s owner
            </Link>
            <form action={redeemLoginLinkAction}>
              <input type="hidden" name="token" value={token} />
              <Button type="submit" variant="outline" className="w-full">
                Switch to {link.name}
              </Button>
            </form>
          </div>
        </>
      ) : link ? (
        <>
          <h1 className="font-serif text-3xl leading-tight text-foreground">Continue as {link.name}&apos;s owner</h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            This signs in this browser. The link then stops working. If {link.name} isn&apos;t your agent, close this
            page.
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
