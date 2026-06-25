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
