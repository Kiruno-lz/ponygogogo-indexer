/**
 * PonyGame v2 session lifecycle through the real handlers (createTestIndexer, simulated events):
 * open → three submissions with anchor seals → settle, and open → forfeit.
 */
import { describe, expect, it } from 'vitest'
import { createTestIndexer } from 'envio'
import {
  GAME,
  PLAYER,
  RIVAL,
  SESSION_A,
  SESSION_B,
  SESSION_C,
  STAKE,
  VAULT,
  anchorOf,
  anchorSealed,
  blockAt,
  cardChosen,
  hex32,
  openSession,
  run,
  sessionForfeited,
  sessionSettled,
  stakeSettled,
  timestampOf,
  txHash,
} from './fixtures.ts'

/** Mirrors PonyGame: chooseCard seals the previous anchor (log 0) before logging CardChosen (log 1). */
function lifecycleA() {
  return [
    ...openSession(100, { sessionId: SESSION_A, horseId: 2 }),
    anchorSealed({ block: 110, logIndex: 0 }, { sessionId: SESSION_A, sourceBlock: 100 }),
    cardChosen({ block: 110, logIndex: 1 }, { sessionId: SESSION_A, checkpoint: 1, cardId: 5, refreshSlots: [1], txSec: 21 }),
    anchorSealed({ block: 120, logIndex: 0 }, { sessionId: SESSION_A, sourceBlock: 110 }),
    cardChosen({ block: 120, logIndex: 1 }, { sessionId: SESSION_A, checkpoint: 2, cardId: 0, txSec: 44 }),
    anchorSealed({ block: 130, logIndex: 0 }, { sessionId: SESSION_A, sourceBlock: 120 }),
    cardChosen({ block: 130, logIndex: 1 }, { sessionId: SESSION_A, checkpoint: 3, cardId: 12, refreshSlots: [0, 2], txSec: 70 }),
    anchorSealed({ block: 200, logIndex: 0 }, { sessionId: SESSION_A, sourceBlock: 130 }),
    // Checkpoint 3's submission turned out invalid: the rules gave card 7 instead of 12.
    sessionSettled(
      { block: 200, logIndex: 1 },
      { sessionId: SESSION_A, rawOrder: [2, 0, 1, 3, 4], settlementOrder: [2, 0, 1, 3, 4], rank: 1, payout: STAKE * 3n, acquired: [5, 0, 7] },
    ),
    stakeSettled({ block: 200, logIndex: 2 }, { sessionId: SESSION_A, payout: STAKE * 3n }),
  ]
}

describe('settled session', () => {
  it('records the session, its submissions and their resolution by SessionSettled.acquired', async () => {
    const indexer = createTestIndexer()
    await run(indexer, lifecycleA())

    const session = await indexer.Session.getOrThrow(SESSION_A)
    expect(session).toEqual({
      id: SESSION_A,
      game: GAME,
      player_id: PLAYER,
      horseId: 2,
      stake: STAKE,
      seed: hex32(0x5eed),
      rulesetHash: '0x5ff01a27886c1cad8a1d286cf2bb15280f711d7133ab3377b375855bf5d3f84b',
      openedAt: BigInt(timestampOf(100)),
      openedBlock: BigInt(blockAt(100)),
      openTx: txHash(100),
      state: 'SETTLED',
      openAnchor: anchorOf(100),
      anchorsSealed: 4,
      choiceCount: 3,
      forfeitSubmissions: 1,
      lastCheckpoint: 3,
      finishTime: [61_000, 62_500, 60_250, 63_000, 64_750],
      rawOrder: [2, 0, 1, 3, 4],
      settlementOrder: [2, 0, 1, 3, 4],
      playerSettlementRank: 1,
      playerRawRank: 1,
      acquired: [5, 0, 7],
      effectiveChoices: 2,
      payout: STAKE * 3n,
      net: STAKE * 2n,
      digest: hex32(0xd1),
      forfeitReason: undefined,
      closedAt: BigInt(timestampOf(200)),
      closedBlock: BigInt(blockAt(200)),
      closeTx: txHash(200),
    })

    const choices = (await indexer.Choice.getAll()).sort((a, b) => a.checkpoint - b.checkpoint)
    expect(choices.map((c) => [c.checkpoint, c.cardId, c.forfeit, c.acquiredCardId, c.effective, c.anchor])).toEqual([
      [1, 5, false, 5, true, anchorOf(110)],
      [2, 0, true, 0, true, anchorOf(120)],
      [3, 12, false, 7, false, anchorOf(130)],
    ])
    expect(choices[0]).toMatchObject({
      id: `${SESSION_A}-1`,
      session_id: SESSION_A,
      player_id: PLAYER,
      refreshSlots: [1],
      txSec: 21,
      blockNumber: BigInt(blockAt(110)),
      timestamp: BigInt(timestampOf(110)),
      txHash: txHash(110),
    })
  })

  it('updates player, horse, card and game statistics once', async () => {
    const indexer = createTestIndexer()
    await run(indexer, lifecycleA())

    expect(await indexer.Player.getOrThrow(PLAYER)).toMatchObject({
      sessionsOpened: 1,
      sessionsSettled: 1,
      sessionsForfeited: 0,
      settlementRankCounts: [1, 0, 0, 0, 0],
      totalStaked: STAKE,
      totalPaidOut: STAKE * 3n,
      totalForfeited: 0n,
      net: STAKE * 2n,
    })

    const horses = (await indexer.HorseStat.getAll()).sort((a, b) => a.horseId - b.horseId)
    expect(horses.map((h) => [h.horseId, h.picked, h.raced, h.physicalWins, h.settlementWins, h.pickedWins])).toEqual([
      [0, 0, 1, 0, 0, 0],
      [1, 0, 1, 0, 0, 0],
      [2, 1, 1, 1, 1, 1],
      [3, 0, 1, 0, 0, 0],
      [4, 0, 1, 0, 0, 0],
    ])

    const cards = (await indexer.CardStat.getAll()).sort((a, b) => a.cardId - b.cardId)
    expect(cards.map((c) => [c.cardId, c.submitted, c.effective, c.acquired])).toEqual([
      [5, 1, 1, 1],
      [7, 0, 0, 1], // picked by the rules, never submitted
      [12, 1, 0, 0], // submitted, did not take effect
    ])

    expect(await indexer.GameStat.getOrThrow(GAME)).toMatchObject({
      sessionsOpened: 1,
      sessionsSettled: 1,
      sessionsForfeited: 0,
      totalStaked: STAKE,
      totalPaidOut: STAKE * 3n,
    })
  })

  it('separates physical and settlement winners and a losing rank', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [
      ...openSession(100, { sessionId: SESSION_B, horseId: 4 }),
      // Horse 1 crossed first, the settlement rules promoted horse 3; the player's horse 4 was 5th.
      sessionSettled(
        { block: 300, logIndex: 0 },
        { sessionId: SESSION_B, rawOrder: [1, 3, 0, 2, 4], settlementOrder: [3, 1, 0, 2, 4], rank: 5, payout: 0n, acquired: [0, 0, 0] },
      ),
      stakeSettled({ block: 300, logIndex: 1 }, { sessionId: SESSION_B, payout: 0n }),
    ])

    expect(await indexer.Session.getOrThrow(SESSION_B)).toMatchObject({
      state: 'SETTLED',
      playerSettlementRank: 5,
      playerRawRank: 5,
      payout: 0n,
      net: -STAKE,
      effectiveChoices: 0,
    })
    const horses = (await indexer.HorseStat.getAll()).sort((a, b) => a.horseId - b.horseId)
    expect(horses.map((h) => [h.horseId, h.physicalWins, h.settlementWins, h.pickedWins])).toEqual([
      [0, 0, 0, 0],
      [1, 1, 0, 0],
      [2, 0, 0, 0],
      [3, 0, 1, 0],
      [4, 0, 0, 0],
    ])
    expect(await indexer.Player.getOrThrow(PLAYER)).toMatchObject({ settlementRankCounts: [0, 0, 0, 0, 1], net: -STAKE })
    expect(await indexer.CardStat.getAll()).toEqual([])
  })
})

describe('forfeited session', () => {
  it('closes with payout 0, loses the stake and leaves submissions unresolved', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [
      ...openSession(100, { sessionId: SESSION_A, horseId: 1 }),
      anchorSealed({ block: 110, logIndex: 0 }, { sessionId: SESSION_A, sourceBlock: 100 }),
      cardChosen({ block: 110, logIndex: 1 }, { sessionId: SESSION_A, checkpoint: 1, cardId: 9, txSec: 22 }),
      // Anchor of block 110 was never sealed and fell out of the history window.
      sessionForfeited({ block: 9_000, logIndex: 0 }, { sessionId: SESSION_A, reason: 1 }),
      stakeSettled({ block: 9_000, logIndex: 1 }, { sessionId: SESSION_A, payout: 0n }),
    ])

    expect(await indexer.Session.getOrThrow(SESSION_A)).toMatchObject({
      state: 'FORFEITED',
      payout: 0n,
      net: -STAKE,
      forfeitReason: 1,
      closedAt: BigInt(timestampOf(9_000)),
      closedBlock: BigInt(blockAt(9_000)),
      closeTx: txHash(9_000),
      rawOrder: undefined,
      acquired: undefined,
      effectiveChoices: undefined,
      anchorsSealed: 1,
    })
    expect(await indexer.Choice.getOrThrow(`${SESSION_A}-1`)).toMatchObject({ cardId: 9, anchor: undefined, effective: undefined, acquiredCardId: undefined })
    expect(await indexer.Player.getOrThrow(PLAYER)).toMatchObject({
      sessionsOpened: 1,
      sessionsSettled: 0,
      sessionsForfeited: 1,
      settlementRankCounts: [0, 0, 0, 0, 0],
      totalStaked: STAKE,
      totalPaidOut: 0n,
      totalForfeited: STAKE,
      net: -STAKE,
    })
    expect(await indexer.HorseStat.getOrThrow('1')).toMatchObject({ picked: 1, raced: 0 })
    expect(await indexer.CardStat.getOrThrow('9')).toMatchObject({ submitted: 1, effective: 0, acquired: 0 })
    expect(await indexer.GameStat.getOrThrow(GAME)).toMatchObject({ sessionsForfeited: 1, totalPaidOut: 0n })
    expect(await indexer.VaultStat.getOrThrow(VAULT)).toMatchObject({ openStake: 0n, openReserve: 0n, totalPayout: 0n, housePnl: STAKE })
  })

  it('records the owner-closed reason and keeps players apart', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [
      ...openSession(100, { sessionId: SESSION_B, player: PLAYER }),
      ...openSession(101, { sessionId: SESSION_C, player: RIVAL, stake: STAKE * 2n }),
      sessionForfeited({ block: 500_000, logIndex: 0 }, { sessionId: SESSION_C, player: RIVAL, stake: STAKE * 2n, reason: 2 }),
    ])

    expect(await indexer.Session.getOrThrow(SESSION_C)).toMatchObject({ state: 'FORFEITED', forfeitReason: 2, net: -STAKE * 2n })
    expect(await indexer.Session.getOrThrow(SESSION_B)).toMatchObject({ state: 'OPEN', payout: undefined, net: undefined })
    expect(await indexer.Player.getOrThrow(RIVAL)).toMatchObject({ sessionsForfeited: 1, totalForfeited: STAKE * 2n })
    expect(await indexer.Player.getOrThrow(PLAYER)).toMatchObject({ sessionsOpened: 1, sessionsForfeited: 0, net: 0n })
    expect(await indexer.GameStat.getOrThrow(GAME)).toMatchObject({ sessionsOpened: 2, sessionsForfeited: 1, totalStaked: STAKE * 3n })
  })
})
