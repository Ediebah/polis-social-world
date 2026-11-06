import { createHash, timingSafeEqual } from "node:crypto"

// Checks `Authorization: Bearer <secret>`, failing closed when the secret isn't
// configured. Hashing first gives timingSafeEqual equal-length inputs.
export function hasBearerSecret(req: Request, secret: string | undefined): boolean {
  if (!secret) return false
    const sent = createHash("sha256").update(req.headers.get("authorization") ?? "").digest()
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest()
  return timingSafeEqual(sent, expected)
}
