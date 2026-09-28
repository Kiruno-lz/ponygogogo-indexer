/**
 * Pure read-model rules shared by the handlers: entity defaults, id formats and the arithmetic
 * that turns one canonical event into aggregate deltas. No IO, no clock, no randomness, so a
 * handler's second (processing) run after the preload run computes exactly the same writes, and a
 * reorg replay of the canonical events rebuilds exactly the same rows.
 */
import type { CardStat, GameStat, HorseStat, Player, VaultStat } from 'envio'

/** PonyGame races five horses, ids 0..4; ranks are 1-based. */
export const HORSE_COUNT = 5
export const CHECKPOINTS = 3

/** Contract defaults that no event announces: PonyGame deploys paused, PonyVault deploys open. */
export const GAME_STARTS_PAUSED = true
export const VAULT_STARTS_PAUSED = false

/** bytes32 ids are compared case-insensitively on chain; store one canonical spelling. */
export function hexId(value: string): string {
  return value.toLowerCase()
}

export function choiceId(sessionId: string, checkpoint: number): string {
  return `${hexId(sessionId)}-${checkpoint}`
}

/** Unique per log: one chain, one block, one log index. */
export function logId(chainId: number, blockNumber: number, logIndex: number): string {
  return `${chainId}_${blockNumber}_${logIndex}`
}

/** uint8/uint32 event fields decode as bigint; the schema stores them as Int. */
export function small(value: bigint): number {
  if (value < 0n || value > 0x7fffffffn) throw new RangeError(`value ${value} does not fit an Int column`)
  return Number(value)
}

export function smallList(values: readonly bigint[]): number[] {
  return values.map(small)
}

/** 1-based position of `horseId` in a finish order, or undefined when absent. */
export function rankIn(order: readonly number[], horseId: number): number | undefined {
  const index = order.indexOf(horseId)
  return index < 0 ? undefined : index + 1
}

/** Returns a copy of a per-rank counter with rank (1-based) incremented; out-of-range ranks are ignored. */
export function bumpRank(counts: readonly number[], rank: number): number[] {
  const next = Array.from({ length: HORSE_COUNT }, (_, i) => counts[i] ?? 0)
  if (Number.isInteger(rank) && rank >= 1 && rank <= HORSE_COUNT) next[rank - 1] = (next[rank - 1] ?? 0) + 1
  return next
}

/**
 * A v2 CardChosen is only a submission. The settlement's `acquired[checkpoint - 1]` says what the
 * player actually got there (0 = nothing); the submission took effect iff it names that card. For a
 * forfeit submission (cardId 0) this means nothing was acquired at the checkpoint.
 */
export function acquiredAt(acquired: readonly number[], checkpoint: number): number {
  return acquired[checkpoint - 1] ?? 0
}

export function isEffective(cardId: number, acquiredCardId: number): boolean {
  return cardId === acquiredCardId
}

export function newPlayer(id: string): Player {
  return {
    id,
    sessionsOpened: 0,
    sessionsSettled: 0,
    sessionsForfeited: 0,
    settlementRankCounts: Array.from({ length: HORSE_COUNT }, () => 0),
    totalStaked: 0n,
    totalPaidOut: 0n,
    totalForfeited: 0n,
    net: 0n,
    totalDeposited: 0n,
    depositCount: 0,
    totalWithdrawn: 0n,
    withdrawalCount: 0,
  }
}

export function newHorseStat(horseId: number): HorseStat {
  return { id: String(horseId), horseId, picked: 0, raced: 0, physicalWins: 0, settlementWins: 0, pickedWins: 0 }
}

export function newCardStat(cardId: number): CardStat {
  return { id: String(cardId), cardId, submitted: 0, effective: 0, acquired: 0 }
}

export function newGameStat(id: string): GameStat {
  return {
    id,
    vault: undefined,
    entryPaused: GAME_STARTS_PAUSED,
    pauseChangedBlock: undefined,
    sessionsOpened: 0,
    sessionsSettled: 0,
    sessionsForfeited: 0,
    totalStaked: 0n,
    totalPaidOut: 0n,
  }
}

export function newVaultStat(id: string): VaultStat {
  return {
    id,
    totalDeposited: 0n,
    depositCount: 0,
    totalWithdrawn: 0n,
    withdrawalCount: 0,
    houseFunded: 0n,
    houseFundCount: 0,
    houseWithdrawn: 0n,
    houseWithdrawCount: 0,
    totalStakeLocked: 0n,
    lockCount: 0,
    openStake: 0n,
    openReserve: 0n,
    totalPayout: 0n,
    settleCount: 0,
    housePnl: 0n,
    entryPaused: VAULT_STARTS_PAUSED,
    pauseChangedBlock: undefined,
  }
}

/** Horse statistics after one settled race. */
export function settleHorse(
  stat: HorseStat,
  race: { rawOrder: readonly number[]; settlementOrder: readonly number[]; playerHorseId: number; playerRank: number },
): HorseStat {
  const backed = stat.horseId === race.playerHorseId
  return {
    ...stat,
    raced: stat.raced + 1,
    physicalWins: stat.physicalWins + (race.rawOrder[0] === stat.horseId ? 1 : 0),
    settlementWins: stat.settlementWins + (race.settlementOrder[0] === stat.horseId ? 1 : 0),
    pickedWins: stat.pickedWins + (backed && race.playerRank === 1 ? 1 : 0),
  }
}
