/**
 * PonyVault → VaultTransfer / StakeLock / VaultStat / Player deposit totals.
 *
 * Vault handlers never read Session: StakeLock carries what StakeSettled needs, so the result does
 * not depend on whether PonyGame's or PonyVault's log comes first in a transaction. Transfers are
 * keyed by (chain, block, log index) and locks move LOCKED → SETTLED once, so an event delivered
 * twice leaves every total unchanged. The protocol has no refunds: a forfeit is StakeSettled with payout 0.
 */
import { indexer, type Enum, type EvmOnEventContext } from 'envio'
import { hexId, logId, newVaultStat } from '../model.ts'

type TransferEvent = {
  readonly chainId: number
  readonly srcAddress: string
  readonly logIndex: number
  readonly block: { readonly number: number; readonly timestamp: number }
  readonly transaction: { readonly hash: string }
}

async function recordTransfer(
  context: EvmOnEventContext,
  event: TransferEvent,
  kind: Enum<'VaultTransferKind'>,
  account: string,
  amount: bigint,
): Promise<void> {
  const id = logId(event.chainId, event.block.number, event.logIndex)
  const [existing, stat] = await Promise.all([context.VaultTransfer.get(id), context.VaultStat.get(event.srcAddress)])
  if (existing) return

  context.VaultTransfer.set({
    id,
    vault: event.srcAddress,
    kind,
    account,
    amount,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  })
  const s = stat ?? newVaultStat(event.srcAddress)
  switch (kind) {
    case 'HOUSE_FUND':
      context.VaultStat.set({ ...s, houseFunded: s.houseFunded + amount, houseFundCount: s.houseFundCount + 1 })
      break
    case 'HOUSE_WITHDRAWAL':
      context.VaultStat.set({ ...s, houseWithdrawn: s.houseWithdrawn + amount, houseWithdrawCount: s.houseWithdrawCount + 1 })
      break
  }
}

indexer.onEvent({ contract: 'PonyVault', event: 'HouseFunded' }, async ({ event, context }) => {
  await recordTransfer(context, event, 'HOUSE_FUND', event.params.funder, event.params.amount)
})

indexer.onEvent({ contract: 'PonyVault', event: 'HouseWithdrawn' }, async ({ event, context }) => {
  await recordTransfer(context, event, 'HOUSE_WITHDRAWAL', event.params.recipient, event.params.amount)
})

indexer.onEvent(
  { contract: 'PonyVault', event: 'StakeLocked' },
  async ({ event, context }) => {
    const id = hexId(event.params.sessionId)
    const [existing, stat] = await Promise.all([context.StakeLock.get(id), context.VaultStat.get(event.srcAddress)])
    if (existing) return

    const { stake, maxPayout, reserve } = event.params
    context.StakeLock.set({
      id,
      vault: event.srcAddress,
      player: event.params.player,
      stake,
      maxPayout,
      reserve,
      state: 'LOCKED',
      payout: undefined,
      lockedBlock: BigInt(event.block.number),
      lockTx: event.transaction.hash,
      settledBlock: undefined,
      settleTx: undefined,
    })
    const s = stat ?? newVaultStat(event.srcAddress)
    context.VaultStat.set({
      ...s,
      totalStakeLocked: s.totalStakeLocked + stake,
      lockCount: s.lockCount + 1,
      openStake: s.openStake + stake,
      openReserve: s.openReserve + reserve,
    })
  },
)

indexer.onEvent(
  { contract: 'PonyVault', event: 'StakeSettled' },
  async ({ event, context }) => {
    const id = hexId(event.params.sessionId)
    const [lock, stat] = await Promise.all([context.StakeLock.get(id), context.VaultStat.get(event.srcAddress)])
    if (!lock) {
      context.log.error(`StakeSettled for unknown lock ${id} at block ${event.block.number}; skipped`)
      return
    }
    if (lock.state !== 'LOCKED') return

    const payout = event.params.payout
    context.StakeLock.set({
      ...lock,
      state: 'SETTLED',
      payout,
      settledBlock: BigInt(event.block.number),
      settleTx: event.transaction.hash,
    })
    const s = stat ?? newVaultStat(event.srcAddress)
    context.VaultStat.set({
      ...s,
      openStake: s.openStake - lock.stake,
      openReserve: s.openReserve - lock.reserve,
      totalPayout: s.totalPayout + payout,
      settleCount: s.settleCount + 1,
      housePnl: s.housePnl + (lock.stake - payout),
    })
  },
)
