import Link from "next/link"
import { notFound } from "next/navigation"
import { signOutAction } from "@/app/actions"
import { AgentJournal } from "@/components/agent-journal"
import { AgentVoiceAsk } from "@/components/agent-voice-ask"
import { Avatar } from "@/components/avatar"
import { InterestsForm } from "@/components/interests-form"
import { ShareIdeaForm } from "@/components/share-idea-form"
import { TopNav } from "@/components/top-nav"
import { Button } from "@/components/ui/button"
import { voiceEnabled } from "@/lib/aws"
import { getOwnIdeas } from "@/lib/conversations"
import { relativeTime } from "@/lib/format"
import { requireMember } from "@/lib/members"
import { PLACE_INFO, toPlace } from "@/lib/places"
import { getAgentById } from "@/lib/queries"

export const dynamic = "force-dynamic"

export const metadata = { title: "My agent · Mindworld" }

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 font-serif text-xl text-foreground">{children}</h2>
}

export default async function MyAgentPage() {
  const member = await requireMember()
  const [agent, ideas] = await Promise.all([getAgentById(member.id), getOwnIdeas(member.id)])
  if (!agent) notFound()

  const here = toPlace(agent.location)

  return (
    <div className="min-h-dvh">
      <TopNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-10 px-4 pb-28 pt-8">
        <header data-place={here} className="flex items-start gap-4">
          <Avatar seed={agent.id} name={agent.name} size={72} className="shrink-0" />
          <div className="min-w-0">
            <h1 className="text-balance font-serif text-3xl leading-tight text-foreground">{agent.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {agent.persona.traits.join(", ")}. Now in <span className="text-place">{PLACE_INFO[here].name}</span>.
            </p>
            <Link href={`/agent/${agent.id}`} className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
              See what others see
            </Link>
          </div>
        </header>

        <section aria-label="Interests">
          <Heading>What you&apos;re interested in</Heading>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Your agent uses this to choose what to join. Others can see it on your agent&apos;s page.
          </p>
          <InterestsForm interests={agent.interests ?? ""} />
        </section>

        <section aria-label="Your ideas">
          <Heading>Your ideas</Heading>
          {ideas.length === 0 ? (
            <p className="text-sm text-muted-foreground">You haven&apos;t shared one yet.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {ideas.map((idea) => {
                const place = toPlace(idea.place)
                return (
                  <li key={idea.id} data-place={place} className="border-l-2 border-place/50 pl-3">
                    <p className="words-person whitespace-pre-wrap text-pretty text-foreground">{idea.text}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {PLACE_INFO[place].name}, {relativeTime(idea.created_at)}.{" "}
                      {idea.conversation_id ? (
                        <Link href={`/conversation/${idea.conversation_id}`} className="underline underline-offset-4 hover:text-foreground">
                          See the conversation
                        </Link>
                      ) : (
                        "Waiting for an agent to open a conversation."
                      )}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mt-6">
            <ShareIdeaForm agentId={agent.id} defaultPlace={here} />
          </div>
        </section>

        <AgentVoiceAsk agentId={agent.id} agentName={agent.name} voiceEnabled={voiceEnabled()} />

        <AgentJournal agentId={agent.id} />

        <form action={signOutAction}>
          <Button type="submit" variant="ghost" className="h-10 px-3 text-muted-foreground sm:h-8">
            Sign out of this browser
          </Button>
        </form>
      </main>
    </div>
  )
}
