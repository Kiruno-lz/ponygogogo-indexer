/**
 * PonyVault events: player deposits/withdrawals, house funding, stake locks and their settlement,
 * pause flags. Includes the real session protocol v2 testnet deployment logs as a fixture.
 */
import { describe, expect, it } from 'vitest'
import { createTestIndexer } from 'envio'
import {
  CHAIN_ID,
  DEPLOYER,
  GAME,
  MON,
  PLAYER,
  RIVAL,
  SESSION_A,
  SESSION_B,
  STAKE,
  VAULT,
  blockAt,
  houseFunded,
  houseWithdrawn,
  openSession,
  playerFlow,
  run,
  stakeSettled,
  timestampOf,
  txHash,
  type Sim,
} from './fixtures.ts'

describe('vault transfers', () => {
  it('aggregates deposits and withdrawals per player and per vault', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [
      playerFlow({ block: 10, logIndex: 0 }, 'Deposited', PLAYER, MON),
      playerFlow({ block: 11, logIndex: 3 }, 'Deposited', RIVAL, MON / 2n),
      playerFlow({ block: 12, logIndex: 0 }, 'Deposited', PLAYER, MON / 4n),
      playerFlow({ block: 20, logIndex: 1 }, 'Withdrawn', PLAYER, MON / 10n),
      playerFlow({ block: 21, logIndex: 0 }, 'Withdrawn', RIVAL, MON / 2n),
    ])

    expect(await indexer.Player.getOrThrow(PLAYER)).toMatchObject({
      totalDeposited: (MON * 5n) / 4n,
      depositCount: 2,
      totalWithdrawn: MON / 10n,
      withdrawalCount: 1,
      sessionsOpened: 0,
      totalStaked: 0n,
    })
    expect(await indexer.Player.getOrThrow(RIVAL)).toMatchObject({
      totalDeposited: MON / 2n,
      depositCount: 1,
      totalWithdrawn: MON / 2n,
      withdrawalCount: 1,
    })
    expect(await indexer.VaultStat.getOrThrow(VAULT)).toMatchObject({
      totalDeposited: (MON * 7n) / 4n,
      depositCount: 3,
      totalWithdrawn: (MON * 6n) / 10n,
      withdrawalCount: 2,
      houseFunded: 0n,
    })

    const rows = await indexer.VaultTransfer.getAll()
    expect(rows).toHaveLength(5)
    expect(await indexer.VaultTransfer.getOrThrow(`${CHAIN_ID}_${blockAt(11)}_3`)).toEqual({
      id: `${CHAIN_ID}_${blockAt(11)}_3`,
      vault: VAULT,
      kind: 'DEPOSIT',
      account: RIVAL,
      amount: MON / 2n,
      blockNumber: BigInt(blockAt(11)),
      timestamp: BigInt(timestampOf(11)),
      txHash: txHash(11),
    })
  })

  it('keeps house funding out of player totals', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [
      houseFunded({ block: 10, logIndex: 0 }, DEPLOYER, 2n * MON),
      houseFunded({ block: 11, logIndex: 0 }, DEPLOYER, MON),
      houseWithdrawn({ block: 30, logIndex: 0 }, DEPLOYER, MON / 2n),
    ])

    expect(await indexer.VaultStat.getOrThrow(VAULT)).toMatchObject({
      houseFunded: 3n * MON,
      houseFundCount: 2,
      houseWithdrawn: MON / 2n,
      houseWithdrawCount: 1,
      totalDeposited: 0n,
    })
    expect(await indexer.Player.getAll()).toEqual([])
    expect((await indexer.VaultTransfer.getAll()).map((t) => t.kind).sort()).toEqual(['HOUSE_FUND', 'HOUSE_FUND', 'HOUSE_WITHDRAWAL'])
  })
})

describe('stake locks', () => {
  it('tracks open stake and reserve until StakeSettled, then the house result', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [
      ...openSession(100, { sessionId: SESSION_A }),
      ...openSession(101, { sessionId: SESSION_B, player: RIVAL, stake: STAKE * 2n }),
    ])
    expect(await indexer.VaultStat.getOrThrow(VAULT)).toMatchObject({
      totalStakeLocked: STAKE * 3n,
      lockCount: 2,
      openStake: STAKE * 3n,
      openReserve: STAKE * 6n,
      settleCount: 0,
    })
    expect(await indexer.StakeLock.getOrThrow(SESSION_A)).toEqual({
      id: SESSION_A,
      vault: VAULT,
      player: PLAYER,
      stake: STAKE,
      maxPayout: STAKE * 3n,
      reserve: STAKE * 2n,
      state: 'LOCKED',
      payout: undefined,
      lockedBlock: BigInt(blockAt(100)),
      lockTx: txHash(100),
      settledBlock: undefined,
      settleTx: undefined,
    })

    // Only the Vault side: a winning payout and a forfeit (payout 0) look the same to the Vault.
    await run(indexer, [
      stakeSettled({ block: 200, logIndex: 0 }, { sessionId: SESSION_A, payout: STAKE * 3n }),
      stakeSettled({ block: 201, logIndex: 0 }, { sessionId: SESSION_B, player: RIVAL, payout: 0n }),
    ])
    expect(await indexer.VaultStat.getOrThrow(VAULT)).toMatchObject({
      openStake: 0n,
      openReserve: 0n,
      totalPayout: STAKE * 3n,
      settleCount: 2,
      housePnl: -STAKE * 2n + STAKE * 2n,
    })
    expect(await indexer.StakeLock.getOrThrow(SESSION_B)).toMatchObject({
      state: 'SETTLED',
      payout: 0n,
      settledBlock: BigInt(blockAt(201)),
      settleTx: txHash(201),
    })
  })
})

describe('real v2 testnet deployment logs', () => {
  // Receipts of the v2 deployment transactions (cast receipt); timestamps from eth_getBlockByNumber.
  const deployment: Sim[] = [
    {
      contract: 'PonyGame',
      event: 'VaultBound',
      logIndex: 41,
      block: { number: 66_458_127, timestamp: 1_790_614_143 },
      params: { vault: VAULT },
    },
    {
      contract: 'PonyVault',
      event: 'HouseFunded',
      logIndex: 40,
      block: { number: 66_458_135, timestamp: 1_790_614_146 },
      transaction: { hash: '0x378f1428ed83b9e4e9cf80039039fde21f45ad67513524e0be887fceb12c8479' },
      params: { funder: DEPLOYER, amount: 3n * MON },
    },
    {
      contract: 'PonyGame',
      event: 'EntryPauseChanged',
      logIndex: 1,
      block: { number: 66_458_146, timestamp: 1_790_614_149 },
      params: { paused: false },
    },
  ]

  it('binds the vault, funds the house and opens entries', async () => {
    const indexer = createTestIndexer()
    await run(indexer, deployment)

    expect(await indexer.GameStat.getOrThrow(GAME)).toEqual({
      id: GAME,
      vault: VAULT,
      entryPaused: false,
      pauseChangedBlock: 66_458_146n,
      sessionsOpened: 0,
      sessionsSettled: 0,
      sessionsForfeited: 0,
      totalStaked: 0n,
      totalPaidOut: 0n,
    })
    expect(await indexer.VaultStat.getOrThrow(VAULT)).toMatchObject({
      houseFunded: 3n * MON,
      houseFundCount: 1,
      entryPaused: false,
      pauseChangedBlock: undefined,
    })
    expect(await indexer.VaultTransfer.getOrThrow(`${CHAIN_ID}_66458135_40`)).toMatchObject({
      kind: 'HOUSE_FUND',
      account: DEPLOYER,
      amount: 3n * MON,
      timestamp: 1_790_614_146n,
      txHash: '0x378f1428ed83b9e4e9cf80039039fde21f45ad67513524e0be887fceb12c8479',
    })
  })

  it('starts the game paused until an EntryPauseChanged says otherwise', async () => {
    const indexer = createTestIndexer()
    await run(indexer, deployment.slice(0, 1))
    expect(await indexer.GameStat.getOrThrow(GAME)).toMatchObject({ entryPaused: true, pauseChangedBlock: undefined })
  })

  it('mirrors the Vault pause flag separately from the Game one', async () => {
    const indexer = createTestIndexer()
    await run(indexer, [
      { contract: 'PonyVault', event: 'EntryPauseChanged', logIndex: 0, block: { number: blockAt(5), timestamp: timestampOf(5) }, params: { paused: true } },
    ])
    expect(await indexer.VaultStat.getOrThrow(VAULT)).toMatchObject({ entryPaused: true, pauseChangedBlock: BigInt(blockAt(5)) })
    expect(await indexer.GameStat.get(GAME)).toBeUndefined()
  })
})
