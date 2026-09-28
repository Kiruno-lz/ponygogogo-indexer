/** Pure read-model rules (src/model.ts), without the indexer runtime. */
import { describe, expect, it } from 'vitest'
import {
  acquiredAt,
  bumpRank,
  choiceId,
  hexId,
  isEffective,
  logId,
  newHorseStat,
  rankIn,
  settleHorse,
  small,
} from '../src/model.ts'

describe('ids', () => {
  it('store bytes32 ids lowercase and derive choice and log ids from them', () => {
    const upper = `0x${'AB'.repeat(32)}`
    expect(hexId(upper)).toBe(`0x${'ab'.repeat(32)}`)
    expect(choiceId(upper, 2)).toBe(`0x${'ab'.repeat(32)}-2`)
    expect(logId(10143, 66_317_137, 30)).toBe('10143_66317137_30')
  })
})

describe('small integers', () => {
  it('accepts the uint8/uint32 range an Int column holds and rejects the rest', () => {
    expect(small(0n)).toBe(0)
    expect(small(600_000n)).toBe(600_000)
    expect(() => small(-1n)).toThrow(RangeError)
    expect(() => small(0x8000_0000n)).toThrow(RangeError)
  })
})

describe('ranks', () => {
  it('finds 1-based positions and ignores absent horses', () => {
    expect(rankIn([2, 0, 1, 3, 4], 2)).toBe(1)
    expect(rankIn([2, 0, 1, 3, 4], 4)).toBe(5)
    expect(rankIn([2, 0, 1, 3, 4], 7)).toBeUndefined()
  })

  it('bumps one rank without mutating and pads short counters to five', () => {
    const counts = [1, 0, 0, 0, 0]
    expect(bumpRank(counts, 3)).toEqual([1, 0, 1, 0, 0])
    expect(counts).toEqual([1, 0, 0, 0, 0])
    expect(bumpRank([], 5)).toEqual([0, 0, 0, 0, 1])
    expect(bumpRank(counts, 0)).toEqual(counts)
    expect(bumpRank(counts, 6)).toEqual(counts)
  })
})

describe('choice resolution', () => {
  it('reads the acquired card of a checkpoint and treats a missing slot as none', () => {
    expect(acquiredAt([5, 0, 7], 1)).toBe(5)
    expect(acquiredAt([5, 0, 7], 3)).toBe(7)
    expect(acquiredAt([5, 0], 3)).toBe(0)
  })

  it('makes a submission effective only when it names the acquired card', () => {
    expect(isEffective(5, 5)).toBe(true)
    expect(isEffective(12, 7)).toBe(false)
    expect(isEffective(0, 0)).toBe(true) // forfeit, nothing acquired
    expect(isEffective(0, 3)).toBe(false) // forfeit submission overridden by the rules
    expect(isEffective(4, 0)).toBe(false) // invalid submission, nothing acquired
  })
})

describe('horse statistics', () => {
  it('credits physical and settlement wins independently and the player pick only at rank 1', () => {
    const race = { rawOrder: [1, 3, 0, 2, 4], settlementOrder: [3, 1, 0, 2, 4], playerHorseId: 3, playerRank: 1 }
    expect(settleHorse(newHorseStat(1), race)).toMatchObject({ raced: 1, physicalWins: 1, settlementWins: 0, pickedWins: 0 })
    expect(settleHorse(newHorseStat(3), race)).toMatchObject({ raced: 1, physicalWins: 0, settlementWins: 1, pickedWins: 1 })
    expect(settleHorse(newHorseStat(3), { ...race, playerRank: 2 })).toMatchObject({ pickedWins: 0 })
  })
})
