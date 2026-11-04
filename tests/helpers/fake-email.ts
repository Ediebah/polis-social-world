// Stands in for @aws-sdk/client-sesv2, so tests see exactly what would have gone to SES.
export const sentEmails: { from: string; to: string; subject: string; text: string; replyTo?: string[]; feedbackTo?: string }[] = []
let failures = 0

export function resetEmail() {
  sentEmails.length = 0
  failures = 0
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
    Content: { Simple: { Subject: { Data: string }; Body: { Text: { Data: string } } } }
  }) {}
}

export class SESv2Client {
  async send(command: SendEmailCommand) {
    if (failures > 0) {
      failures--
      throw new Error("injected SES failure")
    }
    const { FromEmailAddress, Destination, Content, ReplyToAddresses, FeedbackForwardingEmailAddress } = command.input
    sentEmails.push({
      from: FromEmailAddress,
      to: Destination.ToAddresses[0],
      subject: Content.Simple.Subject.Data,
      text: Content.Simple.Body.Text.Data,
      replyTo: ReplyToAddresses,
      feedbackTo: FeedbackForwardingEmailAddress,
    })
    return { MessageId: "fake" }
  }
}
