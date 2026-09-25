const encoder = new TextEncoder()

/**
 * MurmurHash3 (x86, 32-bit). Fast, well distributed and trivially portable,
 * which matters because the server and every SDK must bucket a user identically.
 */
export function murmur3(input: string, seed = 0): number {
  const bytes = encoder.encode(input)
  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593
  const blocks = bytes.length >>> 2
  let h = seed >>> 0

  for (let i = 0; i < blocks; i++) {
    const o = i << 2
    let k = bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! << 24)
    k = Math.imul(k, c1)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, c2)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
  }

  const tail = blocks << 2
  let k = 0
  switch (bytes.length & 3) {
    case 3:
      k ^= bytes[tail + 2]! << 16
    // falls through
    case 2:
      k ^= bytes[tail + 1]! << 8
    // falls through
    case 1:
      k ^= bytes[tail]!
      k = Math.imul(k, c1)
      k = (k << 15) | (k >>> 17)
      k = Math.imul(k, c2)
      h ^= k
  }

  h ^= bytes.length
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** Maps a subject to a stable position in [0, 100) for a given flag. */
export function bucket(flagKey: string, salt: string, subject: string): number {
  return (murmur3(`${flagKey}.${salt}.${subject}`) / 0x1_0000_0000) * 100
}
