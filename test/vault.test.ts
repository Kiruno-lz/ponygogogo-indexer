/** Current Vault house funding, stake locks and settlement. */
import { describe, expect, it } from 'vitest'
import { createTestIndexer } from 'envio'
import {
  DEPLOYER,
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
  run,
  stakeSettled,
  txHash,
} from './fixtures.ts'

describe('vault transfers', () => {

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
