import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2"
import { AWS_REGION, emailCredentials } from "./aws"

let client: SESv2Client | undefined

// Links in email are built from APP_URL and never from a request, because a request's
// Host header is whatever the sender says it is.
export function appUrl(): string | null {
  return process.env.APP_URL?.replace(/\/+$/, "") || null
}

export function emailEnabled(): boolean {
  // The sending domain has no mailbox, so without EMAIL_REPLY_TO nobody would get replies,
  // bounces or reports, and the privacy page tells people to reply to ask for things.
  return Boolean(process.env.EMAIL_FROM && process.env.AWS_EMAIL_ROLE_ARN && process.env.EMAIL_REPLY_TO && appUrl())
}

export async function sendEmail(message: {
  to: string
  subject: string
  text: string
  headers?: { Name: string; Value: string }[]
}): Promise<void> {
  client ??= new SESv2Client({
    region: process.env.AWS_EMAIL_REGION || AWS_REGION,
    credentials: emailCredentials(),
    // So one stuck send can't use up a whole daily email run.
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 },
  })
  await client.send(
    new SendEmailCommand({
      // SES checks the display name and the address separately, so the role's limit to one
      // sending address still applies.
      FromEmailAddress: `Mindworld <${process.env.EMAIL_FROM}>`,
      Destination: { ToAddresses: [message.to] },
      ReplyToAddresses: [process.env.EMAIL_REPLY_TO as string],
      FeedbackForwardingEmailAddress: process.env.EMAIL_REPLY_TO,
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: { Text: { Data: message.text, Charset: "UTF-8" } },
          ...(message.headers ? { Headers: message.headers } : {}),
        },
      },
    }),
  )
}
