import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2"
import { AWS_REGION, emailCredentials } from "./aws"

let client: SESv2Client | undefined

// Links in email are built from APP_URL and never from a request, because a request's
// Host header is whatever the sender says it is.
export function appUrl(): string | null {
  return process.env.APP_URL?.replace(/\/+$/, "") || null
}

export function emailEnabled(): boolean {
  return Boolean(process.env.EMAIL_FROM && process.env.AWS_EMAIL_ROLE_ARN && appUrl())
}

export async function sendEmail(message: { to: string; subject: string; text: string }): Promise<void> {
  client ??= new SESv2Client({
    region: process.env.AWS_EMAIL_REGION || AWS_REGION,
    credentials: emailCredentials(),
  })
  await client.send(
    new SendEmailCommand({
      // SES checks the display name and the address separately, so the role's limit to one
      // sending address still applies.
      FromEmailAddress: `Mindworld <${process.env.EMAIL_FROM}>`,
      Destination: { ToAddresses: [message.to] },
      // The sending domain has no mailbox, so replies and bounces need somewhere to go.
      ...(process.env.EMAIL_REPLY_TO
        ? {
            ReplyToAddresses: [process.env.EMAIL_REPLY_TO],
            FeedbackForwardingEmailAddress: process.env.EMAIL_REPLY_TO,
          }
        : {}),
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: { Text: { Data: message.text, Charset: "UTF-8" } },
        },
      },
    }),
  )
}
