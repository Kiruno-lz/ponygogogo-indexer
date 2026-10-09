import { describe, expect, it } from 'vitest'
import { createTestIndexer } from 'envio'
import { GAME, PLAYER, SESSION_A, SESSION_B, STAKE, blockAt, run, sessionOpened, sessionSettled, timestampOf, txHash, type Sim } from './fixtures.ts'

const LEDGER = '0x0000000000000000000000000000000000000100' as const
const meta = (block: number, logIndex = 0) => ({ block: { number: blockAt(block), timestamp: timestampOf(block) }, logIndex })
const bind = (block = 10, srcAddress: `0x${string}` = GAME): Sim => ({ contract: 'PonyGame', event: 'RewardsBound', srcAddress, ...meta(block), params: { rewards: LEDGER } })
const grant = (block: number, sessionId: string, assetKind: number, assetId: number): Sim => ({
  contract: 'PonyRewards', event: 'CollectibleGranted', srcAddress: LEDGER, ...meta(block, 1),
  transaction: { hash: txHash(block) }, params: { sessionId, player: PLAYER, assetKind: BigInt(assetKind), assetId: BigInt(assetId) },
})

describe('persistent reward read model', () => {
  it('discovers the ledger and records a grant without changing settlement economics', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [bind(), sessionOpened({ block: 100, logIndex: 0 }, { sessionId: SESSION_A }),
      sessionSettled({ block: 200, logIndex: 0 }, { sessionId: SESSION_A, rawOrder: [2,0,1,3,4], settlementOrder: [2,0,1,3,4], rank: 1, payout: 3n * STAKE, acquired: [0,0,0] }),
      grant(200, SESSION_A, 1, 8)])
    const id = `${LEDGER}_${SESSION_A}`
    expect(await indexer.GameStat.getOrThrow(GAME)).toMatchObject({ rewards: LEDGER, sessionsSettled: 1, totalPaidOut: 3n * STAKE })
    expect(await indexer.CollectibleGrant.getOrThrow(id)).toMatchObject({ ledger: LEDGER, sessionId: SESSION_A, player_id: PLAYER, assetKind: 'PONY', assetId: 8, txHash: txHash(200) })
    expect(await indexer.CollectibleOwnership.getOrThrow(`${LEDGER}_${PLAYER}_PONY_8`)).toMatchObject({ grant_id: id })
    expect(await indexer.Session.getOrThrow(SESSION_A)).toMatchObject({ playerSettlementRank: 1, payout: 3n * STAKE })
    expect(await indexer.Player.getOrThrow(PLAYER)).toMatchObject({ sessionsSettled: 1, totalPaidOut: 3n * STAKE })
  })

  it('indexes standalone grants and ignores a repeated session fact', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [bind(), grant(100, SESSION_A, 0, 4), grant(200, SESSION_A, 0, 4), grant(300, SESSION_B, 1, 7)])
    expect(await indexer.Session.getAll()).toEqual([])
    expect(await indexer.CollectibleGrant.getAll()).toHaveLength(2)
    expect(await indexer.CollectibleOwnership.getAll()).toHaveLength(2)
    expect(await indexer.CollectibleGrant.getOrThrow(`${LEDGER}_${SESSION_A}`)).toMatchObject({ blockNumber: BigInt(blockAt(100)), assetKind: 'RARE_CARD', assetId: 4 })
    expect(await indexer.Player.getOrThrow(PLAYER)).toMatchObject({ sessionsOpened: 0, totalPaidOut: 0n })
  })

  it('produces the same ownership when processing one block at a time', async () => {
    const events = [bind(), grant(100, SESSION_A, 1, 8), grant(200, SESSION_B, 0, 4)]
    const whole = createTestIndexer(), batches = createTestIndexer()
    await run(whole, events)
    for (const event of events) await run(batches, [event])
    expect(await batches.CollectibleGrant.getAll()).toEqual(await whole.CollectibleGrant.getAll())
    expect(await batches.CollectibleOwnership.getAll()).toEqual(await whole.CollectibleOwnership.getAll())
  })
})
