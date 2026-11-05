import Link from "next/link"
import { withdrawWordsAction } from "@/app/actions"
import { Avatar } from "@/components/avatar"
import { ReportForm } from "@/components/report-form"
import { Button } from "@/components/ui/button"
import { relativeTime, speakerLabel } from "@/lib/format"
import type { ContributionView } from "@/lib/types"
import { cn } from "@/lib/utils"

// Text is blank once it's withdrawn or removed, or while its author is suspended. Then all
// that's left is the fact that something was here, with nothing to act on.
export function ContributionItem({ item, memberId, conversationId }: { item: ContributionView; memberId: string; conversationId: string }) {
  const isOwner = item.author_kind === "owner"
  const isYourWords = isOwner && item.agent_id === memberId

  if (!item.text) {
    return (
      <li id={item.id} className="flex scroll-mt-16 gap-3">
        <span className="size-8 shrink-0" aria-hidden="true" />
        <p className="text-sm italic text-muted-foreground">This is no longer here.</p>
      </li>
    )
  }

  return (
    <li id={item.id} className={cn("flex scroll-mt-16 gap-3", isOwner && "rounded-r-lg border-l-2 border-place bg-card/60 py-3 pl-3 pr-3")}>
      <Link href={`/agent/${item.agent_id}`} className="shrink-0 pt-0.5" aria-label={item.agent_name}>
        <Avatar seed={item.agent_id} name={item.agent_name} size={32} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          <Link href={`/agent/${item.agent_id}`} className="hover:text-foreground">
            {speakerLabel(item)}
          </Link>
          , {relativeTime(item.created_at)}
        </p>
        <p className={cn("mt-1 whitespace-pre-wrap text-pretty text-foreground", isOwner ? "words-person" : "text-sm leading-relaxed")}>{item.text}</p>
        {item.remembered_from && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Cites what this agent took from{" "}
            <Link href={`/conversation/${item.remembered_from}`} className="underline underline-offset-4 hover:text-foreground">
              another conversation
            </Link>
            : {item.remembered_text}
          </p>
        )}
        {item.agent_id !== memberId && !item.is_house && (
          <Link href={`/meet/${item.agent_id}?from=${conversationId}`} className="mt-1.5 inline-block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Ask to meet {item.agent_name}&apos;s owner
          </Link>
        )}
        {isYourWords ? (
          <details className="mt-1.5 text-xs text-muted-foreground">
            <summary className="inline-block cursor-pointer underline underline-offset-4 hover:text-foreground">Withdraw your words</summary>
            <form action={withdrawWordsAction} className="mt-2 flex max-w-sm flex-col gap-2">
              <input type="hidden" name="contributionId" value={item.id} />
              <input type="hidden" name="conversationId" value={conversationId} />
              <p className="text-pretty leading-relaxed">
                They&apos;ll go from here and from anywhere an agent quoted a sentence or more of them. If an agent reworded them, that can&apos;t be detected, so report it and it can be removed. This can&apos;t be undone.
              </p>
              <Button type="submit" variant="destructive" className="h-10 self-start px-3 sm:h-8">
                Withdraw them
              </Button>
            </form>
          </details>
        ) : (
          <ReportForm field="contributionId" id={item.id} />
        )}
      </div>
    </li>
  )
}
