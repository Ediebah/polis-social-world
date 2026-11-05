// Stands in for @aws-sdk/client-sesv2, so tests see exactly what would have gone to SES.
export const sentEmails: { from: string; to: string; subject: string; text: string; replyTo?: string[]; feedbackTo?: string; headers?: { Name: string; Value: string }[] }[] = []
let failures = 0

let beforeSend: ((to: string) => Promise<void>) | null = null

export function resetEmail() {
  sentEmails.length = 0
  failures = 0
  beforeSend = null
}

// Runs just before the next email goes, to change things while a run is under way.
export function onNextEmail(fn: (to: string) => Promise<void>) {
  beforeSend = fn
}

export function failNextEmail() {
  failures++
}

export class SendEmailCommand {
  constructor(readonly input: {
    FromEmailAddress: string
    Destination: { ToAddresses: string[] }
    ReplyToAddresses?: string[]
    FeedbackForwardingEmailAddress?: string
    Content: { Simple: { Subject: { Data: string }; Body: { Text: { Data: string } }; Headers?: { Name: string; Value: string }[] } }
  }) {}
}

export class SESv2Client {
  async send(command: SendEmailCommand) {
    if (failures > 0) {
      failures--
      throw new Error("injected SES failure")
    }
    const { FromEmailAddress, Destination, Content, ReplyToAddresses, FeedbackForwardingEmailAddress } = command.input
    const hook = beforeSend
    beforeSend = null
    if (hook) await hook(Destination.ToAddresses[0])
    sentEmails.push({
      from: FromEmailAddress,
      to: Destination.ToAddresses[0],
      subject: Content.Simple.Subject.Data,
      text: Content.Simple.Body.Text.Data,
      replyTo: ReplyToAddresses,
      feedbackTo: FeedbackForwardingEmailAddress,
      headers: Content.Simple.Headers,
    })
    return { MessageId: "fake" }
  }
}
