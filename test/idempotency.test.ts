/**
 * Aggregates move once per canonical fact: session facts delivered again, a log already recorded,
 * a second close of the same session or a batch boundary in a different place change no total. Events that reference a
 * session the indexer never saw open are skipped without writing anything.
 */
import { describe, expect, it } from 'vitest'
import { createTestIndexer } from 'envio'
import { logId } from '../src/model.ts'
import {
  CHAIN_ID,
  MON,
  PLAYER,
  SESSION_A,
  SESSION_B,
  STAKE,
  VAULT,
  anchorSealed,
  blockAt,
  cardChosen,
  openSession,
  playerFlow,
  run,
  sessionForfeited,
  sessionSettled,
  stakeSettled,
  timestampOf,
  txHash,
  type Sim,
  type TestIndexer,
} from './fixtures.ts'

/** One settled session plus a withdrawal; `shift` moves every log to a later block. */
function lifecycle(shift = 0): Sim[] {
  const b = (n: number) => n + shift
  return [
    ...openSession(b(100), { sessionId: SESSION_A, horseId: 3 }),
    anchorSealed({ block: b(110), logIndex: 0 }, { sessionId: SESSION_A, sourceBlock: 100 }),
    cardChosen({ block: b(110), logIndex: 1 }, { sessionId: SESSION_A, checkpoint: 1, cardId: 4, txSec: 20 }),
    anchorSealed({ block: b(200), logIndex: 0 }, { sessionId: SESSION_A, sourceBlock: 110 }),
    sessionSettled(
      { block: b(200), logIndex: 1 },
      { sessionId: SESSION_A, rawOrder: [3, 1, 0, 2, 4], settlementOrder: [3, 1, 0, 2, 4], rank: 1, payout: STAKE * 3n, acquired: [4, 0, 0] },
    ),
    stakeSettled({ block: b(200), logIndex: 2 }, { sessionId: SESSION_A, payout: STAKE * 3n }),
    playerFlow({ block: b(201), logIndex: 0 }, 'Withdrawn', PLAYER, STAKE),
  ]
}

async function snapshot(indexer: TestIndexer) {
  const byId = <T extends { id: string }>(rows: readonly T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id))
  return {
    Session: byId(await indexer.Session.getAll()),
    Choice: byId(await indexer.Choice.getAll()),
    Player: byId(await indexer.Player.getAll()),
    HorseStat: byId(await indexer.HorseStat.getAll()),
    CardStat: byId(await indexer.CardStat.getAll()),
    GameStat: byId(await indexer.GameStat.getAll()),
    StakeLock: byId(await indexer.StakeLock.getAll()),
    VaultTransfer: byId(await indexer.VaultTransfer.getAll()),
    VaultStat: byId(await indexer.VaultStat.getAll()),
  }
}

describe('idempotent aggregates', () => {
  it('ignores session events delivered again at later logs', async () => {
    const once = createTestIndexer()
    await run(once, lifecycle())

    // The same session facts again, 5000 blocks later: open, stake lock, seals, choice, settlement.
    const replayed = createTestIndexer()
    await run(replayed, [...lifecycle(), ...lifecycle(5_000).filter((event) => event.event !== 'Withdrawn')])

    expect(await snapshot(replayed)).toEqual(await snapshot(once))
    expect(await replayed.Player.getOrThrow(PLAYER)).toMatchObject({ sessionsOpened: 1, sessionsSettled: 1, totalStaked: STAKE })
    expect(await replayed.CardStat.getOrThrow('4')).toMatchObject({ submitted: 1, effective: 1, acquired: 1 })
    expect(await replayed.Session.getOrThrow(SESSION_A)).toMatchObject({ anchorsSealed: 2, choiceCount: 1 })
    expect(await replayed.VaultStat.getOrThrow(VAULT)).toMatchObject({ lockCount: 1, settleCount: 1, openStake: 0n })
  })

  it('does not re-apply a transfer whose log is already recorded', async () => {
    const indexer = createTestIndexer()
    const id = logId(CHAIN_ID, blockAt(10), 0)
    const recorded = {
      id,
      vault: VAULT,
      kind: 'DEPOSIT' as const,
      account: PLAYER,
      amount: MON,
      blockNumber: BigInt(blockAt(10)),
      timestamp: BigInt(timestampOf(10)),
      txHash: txHash(10),
    }
    indexer.VaultTransfer.set(recorded)
    await run(indexer, [playerFlow({ block: 10, logIndex: 0 }, 'Deposited', PLAYER, MON)])

    expect(await indexer.VaultTransfer.getAll()).toEqual([recorded])
    expect(await indexer.VaultStat.get(VAULT)).toBeUndefined()
    expect(await indexer.Player.get(PLAYER)).toBeUndefined()
  })

  it('does not depend on where batches split', async () => {
    const whole = createTestIndexer()
    await run(whole, lifecycle())

    // One process() call per block: each call continues after the last processed block.
    const blockByBlock = createTestIndexer()
    const byBlock = new Map<number, Sim[]>()
    for (const event of lifecycle()) {
      const block = event.block?.number ?? 0
      byBlock.set(block, [...(byBlock.get(block) ?? []), event])
    }
    expect(byBlock.size).toBe(4)
    for (const events of byBlock.values()) await run(blockByBlock, events)

    expect(await snapshot(blockByBlock)).toEqual(await snapshot(whole))
  })

  it('closes a session at most once: a later forfeit or second settlement is ignored', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [
      ...lifecycle(),
      sessionForfeited({ block: 9_000, logIndex: 0 }, { sessionId: SESSION_A, reason: 1 }),
      sessionSettled(
        { block: 9_001, logIndex: 0 },
        { sessionId: SESSION_A, rawOrder: [0, 1, 2, 3, 4], settlementOrder: [0, 1, 2, 3, 4], rank: 4, payout: 0n, acquired: [0, 0, 0] },
      ),
      stakeSettled({ block: 9_001, logIndex: 1 }, { sessionId: SESSION_A, payout: 0n }),
    ])

    expect(await indexer.Session.getOrThrow(SESSION_A)).toMatchObject({ state: 'SETTLED', playerSettlementRank: 1, payout: STAKE * 3n })
    expect(await indexer.Player.getOrThrow(PLAYER)).toMatchObject({
      sessionsSettled: 1,
      sessionsForfeited: 0,
      settlementRankCounts: [1, 0, 0, 0, 0],
      net: STAKE * 2n,
    })
    expect(await indexer.HorseStat.getOrThrow('3')).toMatchObject({ raced: 1, settlementWins: 1 })
    expect(await indexer.VaultStat.getOrThrow(VAULT)).toMatchObject({ settleCount: 1, totalPayout: STAKE * 3n })
  })

  it('counts repeated deposits in distinct logs, even with the same amount', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [
      playerFlow({ block: 10, logIndex: 0 }, 'Deposited', PLAYER, MON),
      playerFlow({ block: 10, logIndex: 1 }, 'Deposited', PLAYER, MON),
    ])
    expect(await indexer.Player.getOrThrow(PLAYER)).toMatchObject({ totalDeposited: 2n * MON, depositCount: 2 })
  })
})

describe('events for sessions the indexer never saw open', () => {
  it('are skipped without creating rows', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [
      cardChosen({ block: 10, logIndex: 0 }, { sessionId: SESSION_B, checkpoint: 1, cardId: 3, txSec: 20 }),
      anchorSealed({ block: 11, logIndex: 0 }, { sessionId: SESSION_B, sourceBlock: 10 }),
      sessionSettled(
        { block: 12, logIndex: 0 },
        { sessionId: SESSION_B, rawOrder: [0, 1, 2, 3, 4], settlementOrder: [0, 1, 2, 3, 4], rank: 1, payout: STAKE * 3n, acquired: [3, 0, 0] },
      ),
      sessionForfeited({ block: 13, logIndex: 0 }, { sessionId: SESSION_B, reason: 1 }),
      stakeSettled({ block: 13, logIndex: 1 }, { sessionId: SESSION_B, payout: 0n }),
    ])
    expect(await snapshot(indexer)).toEqual({
      Session: [],
      Choice: [],
      Player: [],
      HorseStat: [],
      CardStat: [],
      GameStat: [],
      StakeLock: [],
      VaultTransfer: [],
      VaultStat: [],
    })
  })

  it('ignore an anchor for a block that is neither the open block nor a choice block', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [
      ...openSession(100, { sessionId: SESSION_A }),
      anchorSealed({ block: 150, logIndex: 0 }, { sessionId: SESSION_A, sourceBlock: 140 }),
    ])
    expect(await indexer.Session.getOrThrow(SESSION_A)).toMatchObject({ anchorsSealed: 0, openAnchor: undefined })
  })
})
