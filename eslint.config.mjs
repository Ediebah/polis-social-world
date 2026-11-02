import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Existing components read browser-only state (localStorage) after mount, and
      // are due to be replaced with the pilot screens. Keep it visible until then.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([".next/**", "next-env.d.ts", ".remember/**", ".playwright-mcp/**"]),
])
