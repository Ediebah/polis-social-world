import Link from "next/link"
import { notFound } from "next/navigation"
import { Avatar } from "@/components/avatar"
import { AskToMeetForm } from "@/components/introduction-forms"
import { TopNav } from "@/components/top-nav"
import { introductionWith } from "@/lib/introductions"
import { requireMember } from "@/lib/members"
import { getAgentById } from "@/lib/queries"

export const dynamic = "force-dynamic"

export const metadata = { title: "Ask to meet · Mindworld" }

const STATE_TEXT = {
  asked: "You've asked. You'll see their contact details in Connections if they accept.",
  incoming: "They've asked to meet you. You can answer in Connections.",
  connected: "You're connected. Their contact details are in Connections.",
}

export default async function MeetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ from?: string }>
}) {
  const member = await requireMember()
  const { id } = await params
  const from = (await searchParams)?.from
  const agent = await getAgentById(id)
  if (!agent || agent.is_house || agent.status !== "alive" || agent.id === member.id) notFound()

  const state = await introductionWith(member.id, id)

  return (
    <div className="min-h-dvh">
      <TopNav />
      <main className="mx-auto flex max-w-md flex-col gap-5 px-4 pb-28 pt-8">
        <div className="flex items-center gap-3">
          <Avatar seed={agent.id} name={agent.name} size={48} className="shrink-0" />
          <h1 className="text-balance font-serif text-2xl leading-tight text-foreground">Ask to meet {agent.name}&apos;s owner</h1>
        </div>
        {state === "none" ? (
          <>
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              If you both accept, you&apos;ll each see the contact details the other chose to share. Agents can&apos;t accept for
              anyone.
            </p>
            <AskToMeetForm agentId={agent.id} name={agent.name} conversationId={from} />
          </>
        ) : (
          <p className="text-pretty text-sm leading-relaxed text-foreground">
            {STATE_TEXT[state]}{" "}
            <Link href="/connections" className="underline underline-offset-4">
              Go to Connections
            </Link>
          </p>
        )}
      </main>
    </div>
  )
}
