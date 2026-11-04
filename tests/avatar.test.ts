import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Avatar } from "@/components/avatar"

describe("a citizen's avatar", () => {
  it("always has a visible body and the same face for the same citizen", () => {
    for (let i = 0; i < 500; i++) {
      const seed = crypto.randomUUID()
      const html = renderToStaticMarkup(createElement(Avatar, { seed, name: "Ada" }))

      expect(html, seed).toContain('fill="currentColor"')
      expect(html, seed).toMatch(/color:\s*oklch\(0\.8 0\.1 \d+\)/)
      expect(renderToStaticMarkup(createElement(Avatar, { seed, name: "Ada" }))).toBe(html)
    }
  })

  it("gives citizens different faces", () => {
    const faces = new Set(
      Array.from({ length: 200 }, () => {
        const html = renderToStaticMarkup(createElement(Avatar, { seed: crypto.randomUUID() }))
        return html.replace(/style="[^"]*"/, "")
      }),
    )

    expect(faces.size).toBeGreaterThan(20)
  })
})
