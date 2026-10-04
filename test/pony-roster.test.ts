import { expect, it } from 'vitest'
import { createTestIndexer } from 'envio'
import { PLAYER, SESSION_A, STAKE, run, sessionOpened, sessionSettled, type Sim } from './fixtures.ts'

it('stores the roster and counts the participating identities, not the five lane numbers', async () => {
  const indexer = createTestIndexer()
  const roster = [8,5,6,7,0]
  const opened = sessionOpened({ block: 100, logIndex: 0 }, { sessionId: SESSION_A, horseId: 1 })
  const modern = { ...opened, event: 'SessionOpened', params: { ...opened.params, roster: roster.map(BigInt) } } as Sim
  await run(indexer, [modern, sessionSettled({ block: 200, logIndex: 1 }, { sessionId: SESSION_A,
    rawOrder: [0,1,2,3,4], settlementOrder: [0,1,2,3,4], rank: 2, payout: STAKE, acquired: [0,0,0] })])
  expect(await indexer.Session.getOrThrow(SESSION_A)).toMatchObject({ roster, ponyId: 5, player_id: PLAYER })
  expect(await indexer.HorseStat.getOrThrow('8')).toMatchObject({ ponyId: 8, raced: 1, physicalWins: 1, settlementWins: 1 })
  expect(await indexer.HorseStat.getOrThrow('5')).toMatchObject({ picked: 1, raced: 1 })
  expect(await indexer.HorseStat.get('1')).toBeUndefined()
})
