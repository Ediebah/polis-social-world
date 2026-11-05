"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Compass, Home, User, Users } from "lucide-react"
import { cn } from "@/lib/utils"

const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/me", label: "My agent", icon: User },
  { href: "/connections", label: "Connections", icon: Users },
]

export function TabLinks({ waiting, stacked = false }: { waiting: number; stacked?: boolean }) {
  const pathname = usePathname()

  return (
    <ul className={cn("flex", stacked ? "justify-around" : "items-center gap-1")}>
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
        const badge = href === "/connections" && waiting > 0 ? waiting : null
        return (
          <li key={href} className={stacked ? "flex-1" : undefined}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center transition-colors",
                stacked ? "min-h-14 flex-col justify-center gap-0.5 text-[11px]" : "gap-1.5 rounded-md px-2.5 py-1.5 text-sm",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                !stacked && active && "bg-secondary",
              )}
            >
              {stacked && <Icon className="size-5" aria-hidden="true" />}
              {label}
              {badge && (
                <span className={cn("flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground", stacked && "absolute right-[calc(50%-1.5rem)] top-1.5")}>
                  {badge}
                  <span className="sr-only"> waiting for you</span>
                </span>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
