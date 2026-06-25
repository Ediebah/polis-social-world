// components/agent-voice-ask.tsx
// Ask a citizen a question — by voice where the browser can capture a mic,
// otherwise by typing — and hear it answer in first person about what it's been
// doing. Voice in: mic -> 16kHz mono PCM -> /api/transcribe (Amazon Transcribe).
// Voice out: /api/speak (Amazon Polly), with the browser's speech synthesis as a
// fallback. Both AWS routes reuse the app's OIDC role; everything fails soft.
"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Mic, Send, Square, Volume2 } from "lucide-react"

// Flatten captured Float32 mic frames, resample to 16kHz, and pack as signed
// 16-bit little-endian PCM — the format Amazon Transcribe streaming expects.
function floatChunksToPcm16(chunks: Float32Array[], inRate: number, outRate: number): Uint8Array {
  let len = 0
  for (const c of chunks) len += c.length
  const merged = new Float32Array(len)
  let off = 0
  for (const c of chunks) {
    merged.set(c, off)
    off += c.length
  }
  const ratio = inRate / outRate
  const outLen = Math.max(0, Math.floor(merged.length / ratio))
  const pcm = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const s = Math.max(-1, Math.min(1, merged[Math.floor(i * ratio)] || 0))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return new Uint8Array(pcm.buffer)
}

export function AgentVoiceAsk({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [micSupported, setMicSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [thinking, setThinking] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<any>(null)
  const procRef = useRef<any>(null)
  const chunksRef = useRef<Float32Array[]>([])
  const audioElRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const hasMic = Boolean(navigator.mediaDevices?.getUserMedia)
    const hasCtx = Boolean((window as any).AudioContext || (window as any).webkitAudioContext)
    setMicSupported(hasMic && hasCtx)
    return () => {
      // best-effort cleanup if we unmount mid-capture
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop())
      } catch {
        // ignore
      }
      try {
        ctxRef.current?.close?.()
      } catch {
        // ignore
      }
    }
  }, [])

  // ---- voice out: Polly, falling back to the browser voice ----
  function browserSpeak(text: string) {
    try {
      const synth = window.speechSynthesis
      if (!synth || !text) return
      synth.cancel()
      synth.speak(new SpeechSynthesisUtterance(text))
    } catch {
      // ignore — text still shows
    }
  }

  async function speak(text: string) {
    if (!text) return
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, id: agentId }),
      })
      if (!res.ok) throw new Error("tts unavailable")
      const blob = await res.blob()
      if (!blob.size) throw new Error("empty audio")
      const url = URL.createObjectURL(blob)
      const el = audioElRef.current ?? new Audio()
      audioElRef.current = el
      el.src = url
      el.onended = () => URL.revokeObjectURL(url)
      await el.play()
    } catch {
      browserSpeak(text)
    }
  }

  // ---- ask the agent ----
  async function ask(raw: string) {
    const q = raw.trim()
    if (!q || thinking) return
    setThinking(true)
    setAnswer("")
    try {
      const res = await fetch(`/api/ask/${agentId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      })
      const data = await res.json()
      const a = typeof data?.answer === "string" ? data.answer : ""
      setAnswer(a)
      if (a) speak(a)
    } catch {
      setAnswer("")
    } finally {
      setThinking(false)
    }
  }

  // ---- voice in: capture mic as PCM, transcribe, then ask ----
  async function startListening() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      const ctx = new Ctx()
      await ctx.resume?.()
      ctxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      procRef.current = proc
      chunksRef.current = []
      proc.onaudioprocess = (e: any) => {
        chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      }
      source.connect(proc)
      proc.connect(ctx.destination) // outputs silence; needed for the processor to run
      setListening(true)
    } catch {
      // mic denied/unavailable — drop to the text input
      setMicSupported(false)
      setListening(false)
    }
  }

  async function stopListening() {
    setListening(false)
    const ctx = ctxRef.current
    const sampleRate = ctx?.sampleRate ?? 48000
    try {
      procRef.current?.disconnect()
    } catch {
      // ignore
    }
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {
      // ignore
    }
    try {
      await ctx?.close?.()
    } catch {
      // ignore
    }

    const pcm = floatChunksToPcm16(chunksRef.current, sampleRate, 16000)
    chunksRef.current = []
    if (pcm.byteLength < 2000) return // too short to mean anything

    setThinking(true)
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: pcm,
      })
      const data = await res.json()
      const t = typeof data?.transcript === "string" ? data.transcript : ""
      if (t) {
        setQuestion(t)
        ask(t)
      } else {
        setThinking(false)
      }
    } catch {
      setThinking(false)
    }
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
        <Mic className="size-4 text-primary" aria-hidden="true" />
        Ask {agentName}
      </h2>
      <div className="rounded-lg border border-border/70 bg-card/50 px-5 py-4">
        {micSupported ? (
          <button
            type="button"
            onClick={() => (listening ? stopListening() : startListening())}
            disabled={thinking}
            aria-pressed={listening}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-4 py-2 text-sm text-foreground transition-colors hover:border-primary/40 disabled:opacity-50"
          >
            {listening ? (
              <Square className="size-4 text-primary" aria-hidden="true" />
            ) : (
              <Mic className="size-4 text-primary" aria-hidden="true" />
            )}
            {listening ? "listening… tap to stop" : "ask out loud"}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") ask(question)
              }}
              maxLength={280}
              placeholder={`Ask ${agentName} something…`}
              aria-label={`Ask ${agentName} a question`}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => ask(question)}
              disabled={thinking || !question.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground transition-colors hover:border-primary/40 disabled:opacity-50"
            >
              <Send className="size-4" aria-hidden="true" />
              ask
            </button>
          </div>
        )}

        {thinking ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {agentName} is thinking…
          </p>
        ) : answer ? (
          <div className="mt-4 flex items-start gap-3">
            <p className="min-w-0 flex-1 text-pretty text-sm italic leading-relaxed text-foreground">{answer}</p>
            <button
              type="button"
              onClick={() => speak(answer)}
              aria-label="Replay answer"
              title="Replay"
              className="shrink-0 rounded-md border border-border bg-secondary/40 p-1.5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Volume2 className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
