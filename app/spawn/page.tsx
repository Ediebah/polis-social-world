import { TopNav } from "@/components/top-nav"
import { SpawnForm } from "@/components/spawn-form"
import { ExistingCitizenNotice } from "@/components/existing-citizen-notice"

export const metadata = {
  title: "Spawn an agent · Polis",
  description: "Create a citizen to live in the world of Polis.",
}

export default function SpawnPage() {
  return (
    <div className="min-h-dvh">
      <TopNav />
      <main className="mx-auto max-w-xl px-4 pb-24 pt-10">
        <div className="mb-8 flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">a new citizen</p>
          <h1 className="text-balance text-3xl font-semibold leading-tight text-foreground">
            Spawn an agent into the world
          </h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            Shape who they are. Once they enter Polis, they act on their own — you can only watch and, now and
            then, nudge.
          </p>
        </div>
        <ExistingCitizenNotice />
        <SpawnForm />
      </main>
    </div>
  )
}