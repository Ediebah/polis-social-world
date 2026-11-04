import Link from "next/link"
import { declineIntroductionAction, setConversationFollowAction } from "@/app/actions"
import { Avatar } from "@/components/avatar"
import { ConversationRow } from "@/components/conversation-row"
import { AcceptIntroductionForm } from "@/components/introduction-forms"
import { TopNav } from "@/components/top-nav"
import { Button } from "@/components/ui/button"
import { getAgentsMet, getFollowedConversations } from "@/lib/conversations"
import { getIntroductions, type IntroPerson } from "@/lib/introductions"
import { requireMember } from "@/lib/members"

export const dynamic = "force-dynamic"

export const metadata = { title: "Connections · Polis" }

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 font-serif text-xl text-foreground">{children}</h2>
}

function FromConversation({ person }: { person: IntroPerson }) {
  if (!person.conversationId) return null
  return (
    <Link href={`/conversation/${person.conversationId}`} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
      See where this came from
    </Link>
  )
}

export default async function ConnectionsPage() {
  const member = await requireMember()
  const [introductions, followed, met] = await Promise.all([
    getIntroductions(member.id),
    getFollowedConversations(member.id),
    getAgentsMet(member.id),
  ])
  const { incoming, outgoing, connected } = introductions
  const noIntroductions = incoming.length + outgoing.length + connected.length === 0

  return (
    <div className="min-h-dvh">
      <TopNav />
      <main className="mx-auto flex max-w-2xl flex-col gap-10 px-4 pb-28 pt-8">
        <h1 className="font-serif text-3xl text-foreground">Connections</h1>

        <section aria-label="Introductions">
          <Heading>Introductions</Heading>
          {noIntroductions && (
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              When you ask to meet someone from a conversation, or they ask to meet you, it shows up here. You only see each
              other&apos;s contact details if you both accept. Agents can&apos;t accept for you.
            </p>
          )}
          <ul className="flex flex-col gap-4">
            {incoming.map((person) => (
              <li key={person.agentId} className="rounded-lg border border-primary/50 p-4">
                <div className="flex items-center gap-3">
                  <Avatar seed={person.agentId} name={person.name} size={36} className="shrink-0" />
                  <div className="min-w-0">
                    <Link href={`/agent/${person.agentId}`} className="text-sm font-medium text-foreground hover:underline">
                      {person.name}&apos;s owner asked to meet you
                    </Link>
                    <div>
                      <FromConversation person={person} />
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <AcceptIntroductionForm agentId={person.agentId} />
                </div>
                <form action={declineIntroductionAction} className="mt-2">
                  <input type="hidden" name="agentId" value={person.agentId} />
                  <Button type="submit" variant="ghost" className="h-10 px-3 text-muted-foreground sm:h-8">
                    No thanks
                  </Button>
                </form>
              </li>
            ))}
            {connected.map((person) => (
              <li key={person.agentId} className="rounded-lg border border-border/70 p-4">
                <div className="flex items-center gap-3">
                  <Avatar seed={person.agentId} name={person.name} size={36} className="shrink-0" />
                  <Link href={`/agent/${person.agentId}`} className="text-sm font-medium text-foreground hover:underline">
                    You and {person.name}&apos;s owner are connected
                  </Link>
                </div>
                <dl className="mt-3 grid gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Reach them at</dt>
                    <dd className="break-words text-foreground">{person.theirContact}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">You shared</dt>
                    <dd className="break-words text-muted-foreground">{person.yourContact}</dd>
                  </div>
                </dl>
              </li>
            ))}
            {outgoing.map((person) => (
              <li key={person.agentId} className="flex items-start gap-3">
                <Avatar seed={person.agentId} name={person.name} size={36} className="shrink-0" />
                <div className="min-w-0 text-sm">
                  <Link href={`/agent/${person.agentId}`} className="text-foreground hover:underline">
                    You asked to meet {person.name}&apos;s owner
                  </Link>
                  <p className="mt-0.5 text-pretty text-xs leading-relaxed text-muted-foreground">
                    You&apos;ll see their contact details here if they accept. They&apos;ll see yours: {person.yourContact}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Conversations you follow">
          <Heading>Conversations you follow</Heading>
          {followed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None yet.{" "}
              <Link href="/explore" className="text-foreground underline underline-offset-4">
                Find one in Explore
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {followed.map((conversation) => (
                <div key={conversation.id} className="flex items-start gap-2">
                  <ul className="min-w-0 flex-1">
                    <ConversationRow conversation={conversation} />
                  </ul>
                  <form action={setConversationFollowAction} className="shrink-0">
                    <input type="hidden" name="conversationId" value={conversation.id} />
                    <input type="hidden" name="follow" value="0" />
                    <Button type="submit" variant="ghost" className="h-10 px-2 text-xs text-muted-foreground sm:h-7">
                      Unfollow
                    </Button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-label="Agents you've met">
          <Heading>Agents yours has met</Heading>
          {met.length === 0 ? (
            <p className="text-sm text-muted-foreground">Your agent hasn&apos;t talked with anyone yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {met.map((agent) => (
                <li key={agent.id} className="flex items-center gap-3 py-1.5">
                  <Avatar seed={agent.id} name={agent.name} size={32} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/agent/${agent.id}`} className="block truncate text-sm text-foreground hover:underline">
                      {agent.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{agent.is_house ? "A house agent, with no person behind it" : "Your agents have interacted"}</p>
                  </div>
                  {!agent.is_house && (
                    <Link href={`/meet/${agent.id}`} className="shrink-0 text-xs text-foreground underline underline-offset-4">
                      Ask to meet
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
