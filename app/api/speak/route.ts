// app/api/speak/route.ts
// Text-to-speech via Amazon Polly (neural voices), reusing the DSQL OIDC role —
// no new API key. Returns audio/mpeg. A voice is chosen deterministically per
// citizen id so different citizens sound different. A non-OK response tells the
// client to fall back to the browser's speech synthesis.
import { NextResponse } from "next/server"
import { PollyClient, SynthesizeSpeechCommand, type VoiceId } from "@aws-sdk/client-polly"
import { AWS_REGION, voiceCredentials } from "@/lib/aws"

export const dynamic = "force-dynamic"
export const maxDuration = 30

// A spread of Polly neural voices; one is picked per citizen.
const VOICES: VoiceId[] = [
  "Joanna",
  "Matthew",
  "Kendra",
  "Joey",
  "Ruth",
  "Stephen",
  "Danielle",
  "Gregory",
  "Kimberly",
  "Salli",
]

function pickVoice(seed: string): VoiceId {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return VOICES[h % VOICES.length]
}

const client = new PollyClient({ region: AWS_REGION, credentials: voiceCredentials() })

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const text = String(body?.text ?? "").trim().slice(0, 1000)
    const seed = String(body?.id ?? "")
    if (!text) return new NextResponse(null, { status: 204 })

    const out = await client.send(
      new SynthesizeSpeechCommand({
        Text: text,
        OutputFormat: "mp3",
        Engine: "neural",
        VoiceId: pickVoice(seed),
      }),
    )
    if (!out.AudioStream) return new NextResponse(null, { status: 502 })

    const bytes = await out.AudioStream.transformToByteArray()
    return new NextResponse(Buffer.from(bytes), {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    })
  } catch (err) {
    console.error("[polis] speak (polly) error:", err)
    // Non-OK -> the client falls back to browser speech synthesis.
    return new NextResponse(null, { status: 502 })
  }
}
