export const metadata = { title: "Daily emails stopped · Mindworld", robots: { index: false } }

export default function UnsubscribedPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-16">
      <h1 className="font-serif text-3xl leading-tight text-foreground">You won&apos;t get daily emails</h1>
      <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
        You can turn them back on from My agent, and you&apos;ll still get sign-in links when you ask for them.
      </p>
    </main>
  )
}
