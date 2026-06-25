// app/api/transcribe/route.ts
// Speech-to-text via Amazon Transcribe streaming, reusing the DSQL OIDC role —
// no new API key. The request body is raw 16 kHz, mono, signed 16-bit
// little-endian PCM (the browser converts mic audio to this before posting).
// Returns { transcript }. Fails soft to { transcript: "" } so the UI can fall
// back to typing.
import { NextResponse } from "next/server"
import {
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
} from "@aws-sdk/client-transcribe-streaming"
import { AWS_REGION, voiceCredentials } from "@/lib/aws"

export const dynamic = "force-dynamic"
export const maxDuration = 30

const SAMPLE_RATE = 16000
const client = new TranscribeStreamingClient({ region: AWS_REGION, credentials: voiceCredentials() })

export async function POST(req: Request) {
  try {
    const pcm = new Uint8Array(await req.arrayBuffer())
    // ~ under 60ms of audio — nothing worth transcribing.
    if (pcm.byteLength < 2000) return NextResponse.json({ transcript: "" })

    // Feed the PCM to Transcribe in ~100ms chunks (1600 samples * 2 bytes).
    const CHUNK = 3200
    async function* audioStream() {
      for (let i = 0; i < pcm.byteLength; i += CHUNK) {
        yield { AudioEvent: { AudioChunk: pcm.subarray(i, Math.min(i + CHUNK, pcm.byteLength)) } }
      }
    }

    const resp = await client.send(
      new StartStreamTranscriptionCommand({
        LanguageCode: "en-US",
        MediaEncoding: "pcm",
        MediaSampleRateHertz: SAMPLE_RATE,
        AudioStream: audioStream(),
      }),
    )

    let transcript = ""
    if (resp.TranscriptResultStream) {
      for await (const event of resp.TranscriptResultStream) {
        const results = event.TranscriptEvent?.Transcript?.Results ?? []
        for (const r of results) {
          if (!r.IsPartial) {
            const t = r.Alternatives?.[0]?.Transcript
            if (t) transcript += (transcript ? " " : "") + t
          }
        }
      }
    }

    return NextResponse.json({ transcript: transcript.trim() })
  } catch (err) {
    console.error("[polis] transcribe error:", err)
    return NextResponse.json({ transcript: "" })
  }
}
