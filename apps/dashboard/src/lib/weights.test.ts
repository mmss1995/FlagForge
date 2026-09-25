import { describe, expect, it } from 'vitest'
import { evenWeights, setWeight, totalWeight } from './weights'

const w = (...pairs: [string, number][]) => pairs.map(([variationId, weight]) => ({ variationId, weight }))

describe('evenWeights', () => {
  it('splits evenly and always totals 100', () => {
    expect(evenWeights(['a', 'b'])).toEqual(w(['a', 50], ['b', 50]))
    expect(evenWeights(['a', 'b', 'c'])).toEqual(w(['a', 33.34], ['b', 33.33], ['c', 33.33]))
    expect(totalWeight(evenWeights(['a', 'b', 'c', 'd', 'e', 'f', 'g']))).toBe(100)
  })
})

describe('setWeight', () => {
  it('gives the rest to the other slice in a two-way split', () => {
    expect(setWeight(w(['on', 10], ['off', 90]), 0, 30)).toEqual(w(['on', 30], ['off', 70]))
  })

  it('rebalances several slices proportionally', () => {
    expect(setWeight(w(['a', 10], ['b', 45], ['c', 45]), 0, 30)).toEqual(w(['a', 30], ['b', 35], ['c', 35]))
    expect(setWeight(w(['a', 20], ['b', 60], ['c', 20]), 0, 60)).toEqual(w(['a', 60], ['b', 30], ['c', 10]))
  })

  it('shares equally when the other slices are all zero', () => {
    expect(setWeight(w(['a', 100], ['b', 0], ['c', 0]), 0, 40)).toEqual(w(['a', 40], ['b', 30], ['c', 30]))
  })

  it('clamps to 0..100 and never drifts from 100', () => {
    expect(setWeight(w(['a', 50], ['b', 50]), 0, 140)).toEqual(w(['a', 100], ['b', 0]))
    expect(setWeight(w(['a', 50], ['b', 50]), 1, -5)).toEqual(w(['a', 100], ['b', 0]))
    for (let v = 0; v <= 100; v += 7.77) {
      expect(totalWeight(setWeight(w(['a', 33.34], ['b', 33.33], ['c', 33.33]), 1, v))).toBe(100)
    }
  })
})
