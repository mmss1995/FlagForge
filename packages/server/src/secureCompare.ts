import { createHash, timingSafeEqual } from 'node:crypto'

/** Constant-time string comparison. Hashing first hides the length of the secret too. */
export function secureCompare(provided: string, secret: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(provided), digest(secret))
}
