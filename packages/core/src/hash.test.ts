import { describe, expect, it } from 'vitest'
import { bucket, murmur3 } from './hash'

describe('murmur3', () => {
  it.each([
    ['', 0, 0],
    ['', 1, 0x514e28b7],
    ['test', 0, 0xba6bd213],
    ['hello', 0, 0x248bfa47],
    ['The quick brown fox jumps over the lazy dog', 0, 0x2e4ff723],
  ])('hash(%j, seed %d) matches the reference implementation', (input, seed, expected) => {
    expect(murmur3(input, seed)).toBe(expected)
  })

  it('hashes multi-byte characters by their UTF-8 bytes', () => {
    expect(murmur3('città')).not.toBe(murmur3('citta'))
    expect(murmur3('città')).toBe(murmur3('città'))
  })
})

describe('bucket', () => {
  it('is stable for the same subject', () => {
    expect(bucket('checkout', 'salt', 'user-1')).toBe(bucket('checkout', 'salt', 'user-1'))
  })

  it('stays within [0, 100)', () => {
    for (let i = 0; i < 1000; i++) {
      const b = bucket('flag', 's', `user-${i}`)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(100)
    }
  })

  it('distributes subjects roughly uniformly', () => {
    const counts = new Array<number>(10).fill(0)
    const n = 20_000
    for (let i = 0; i < n; i++) counts[Math.floor(bucket('flag', 's', `user-${i}`) / 10)]!++
    for (const count of counts) expect(Math.abs(count - n / 10)).toBeLessThan(n * 0.01)
  })

  it('splits users differently for different salts', () => {
    const same = Array.from({ length: 200 }, (_, i) => `u${i}`).filter(
      (u) => bucket('flag', 'a', u) < 50 === bucket('flag', 'b', u) < 50,
    ).length
    // Independent splits agree about half of the time; identical ones would agree always.
    expect(same).toBeGreaterThan(70)
    expect(same).toBeLessThan(130)
  })
})
