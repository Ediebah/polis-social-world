const MAX_ATTEMPTS = 4

// DSQL surfaces write conflicts as serialization failures (40001) at commit, so
// any statement that can collide with another writer runs through this bounded,
// jittered retry.
export async function retryOnConflict<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if ((err as { code?: string })?.code === "40001" && attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 30 * 2 ** attempt + Math.random() * 30))
        continue
      }
      throw err
    }
  }
  throw lastErr
}
