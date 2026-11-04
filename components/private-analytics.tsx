"use client"

import { Analytics } from "@vercel/analytics/next"
import { withoutSecrets } from "@/lib/format"

export function PrivateAnalytics() {
  return <Analytics beforeSend={(event) => ({ ...event, url: withoutSecrets(event.url) })} />
}
