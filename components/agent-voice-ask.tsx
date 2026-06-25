// components/agent-voice-ask.tsx
// Ask a citizen a question — by voice where the browser supports it, otherwise
// by typing — and hear it answer in first person about what it's been doing.
"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Mic, Send, Square, Volume2 } from "lucide-react"

export function AgentVoiceAsk({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [thinking, setThinking] = useState(false)
  // Holds the active SpeechRecognition instance (no DOM type — vendor-prefixed).
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setVoiceSupported(Boolean(SR))
  }, [])

  function speak(text: string) {
    // Speaking is best-effort: if TTS is unavailable, the answer text still shows.
    try {
      const synth = typeof window !== "undefined" ? window.speechSynthesis : null
      if (!synth || !text) return
      synth.cancel()
      synth.speak(new SpeechSynthesisUtterance(text))
    } catch {
      // ignore — text remains visible
    }
  }

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

  function startListening() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    try {
      const rec = new SR()
      rec.lang = "en-US"
      rec.interimResults = false
      rec.maxAlternatives = 1
      rec.onresult = (e: any) => {
        const transcript = String(e?.results?.[0]?.[0]?.transcript ?? "").trim()
        if (transcript) {
          setQuestion(transcript)
          ask(transcript)
        }
      }
      rec.onend = () => setListening(false)
      rec.onerror = () => setListening(false)
      recognitionRef.current = rec
      setListening(true)
      rec.start()
    } catch {
      setListening(false)
    }
  }

  function stopListening() {
    try {
      recognitionRef.current?.stop()
    } catch {
      // ignore
    }
    setListening(false)
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
        <Mic className="size-4 text-primary" aria-hidden="true" />
        Ask {agentName}
      </h2>
      <div className="rounded-lg border border-border/70 bg-card/50 px-5 py-4">
        {voiceSupported ? (
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
