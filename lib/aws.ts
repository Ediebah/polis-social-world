// lib/aws.ts
// Shared AWS credentials for service clients (Polly, Transcribe), reusing the
// same Vercel OIDC -> IAM role that lib/db.ts uses for Aurora DSQL. No static
// keys: the role is assumed via OIDC at request time. The role must allow
// polly:SynthesizeSpeech and transcribe:StartStreamTranscription.
import { awsCredentialsProvider } from "@vercel/functions/oidc"

export const AWS_REGION = process.env.AWS_REGION as string

export function awsCredentials() {
  return awsCredentialsProvider({
    roleArn: process.env.AWS_ROLE_ARN as string,
    clientConfig: { region: AWS_REGION },
  })
}

// Credentials for the voice routes (Polly, Transcribe). These assume a dedicated
// role (AWS_VOICE_ROLE_ARN) that grants polly:SynthesizeSpeech +
// transcribe:StartStreamTranscription, because the Vercel marketplace DSQL role
// is locked by a permissions boundary to data services only. Falls back to the
// DSQL role when unset — in which case the calls are denied and the UI falls
// back to the browser voice / text input.
export function voiceCredentials() {
  return awsCredentialsProvider({
    roleArn: (process.env.AWS_VOICE_ROLE_ARN || process.env.AWS_ROLE_ARN) as string,
    clientConfig: { region: AWS_REGION },
  })
}
