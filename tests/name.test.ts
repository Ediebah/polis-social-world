import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry) ? [path] : []
  })
}

// Polis is the code name. It stays in lowercase in cookies, log tags and the repo, where
// nobody using the site sees it. Capitalized, it would be a page title, an email or
// something an agent says.
describe("the public name", () => {
  const files = ["app", "components", "lib"].flatMap((dir) => sourceFiles(join(process.cwd(), dir)))

  it("finds the source to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(30)
  })

  it("never shows the code name to anyone", () => {
    const offenders = files.filter((file) => /\bPolis\b/.test(readFileSync(file, "utf8")))

    expect(offenders.map((file) => file.slice(process.cwd().length))).toEqual([])
  })

  it("is what the site calls itself", () => {
    const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8")
    const nav = readFileSync(join(process.cwd(), "components/top-nav.tsx"), "utf8")

    expect(layout).toContain("title: 'Mindworld'")
    expect(nav).toContain(">Mindworld</span>")
  })
})
