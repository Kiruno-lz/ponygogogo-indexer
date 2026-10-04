/**
 * Deterministic event builders for createTestIndexer().simulate. Every block number, timestamp,
 * transaction hash and log index is fixed so entity snapshots are exact.
 */
import { createTestIndexer } from 'envio'

export const CHAIN_ID = 10143
/** Session protocol v2 testnet deployment, as in config.yaml (checksummed as the indexer reports them). */
export const GAME = '0x92428770e79A95377c641F2Da9C9D97F4AA899c8'
export const VAULT = '0xb1677bc7bceD53612f9569ac42eE752081485282'
export const DEPLOYER = '0xB2Cd1aBBb940D612A71e545067C05f900B32960e'
export const PLAYER = '0x39fFB4053194CD91D266491C2057A053cD62bB5D'
export const RIVAL = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

export const MON = 10n ** 18n
export const STAKE = (MON * 3n) / 10n // 0.3 MON, tier 1 (PonyGame.stakeForTier)
/** Rules v3 ruleset hash (PaidCardRules.RULESET_HASH, PonyGame.rulesetHash on the v2 deployment). */
export const RULESET = '0x5ff01a27886c1cad8a1d286cf2bb15280f711d7133ab3377b375855bf5d3f84b'

export type TestIndexer = ReturnType<typeof createTestIndexer>
type ChainRun = NonNullable<Parameters<TestIndexer['process']>[0]['chains'][typeof CHAIN_ID]>
export type Sim = NonNullable<ChainRun['simulate']>[number]

/**
 * Builders take block numbers relative to BASE_BLOCK: the indexer drops events below the configured
 * start_block (66_458_114), so absolute numbers must sit after the deployment. `blockAt(n)` is the
 * absolute one.
 */
export const BASE_BLOCK = 66_500_000
export const blockAt = (relative: number): number => BASE_BLOCK + relative

export const hex32 = (n: number | bigint): string => `0x${BigInt(n).toString(16).padStart(64, '0')}`
export const txHash = (block: number, index = 0): string => hex32(BigInt(block) * 1000n + BigInt(index))
/** Monad testnet makes ~2.5 blocks per second; any strictly increasing mapping works. */
export const timestampOf = (block: number): number => 1_790_000_000 + Math.floor(block / 2)

/** Deterministic stand-in for the block hash of relative block n. */
export const anchorOf = (relative: number): string => hex32(0xa000 + relative)

export const SESSION_A = hex32(0xa1)
export const SESSION_B = hex32(0xb2)
export const SESSION_C = hex32(0xc3)

type At = { block: number; logIndex: number; tx?: number }

function blockMeta({ block, logIndex }: At) {
  return { logIndex, block: { number: blockAt(block), timestamp: timestampOf(block) } }
}

/** Events whose config.yaml field_selection includes the transaction hash. */
function meta(at: At) {
  return { ...blockMeta(at), transaction: { hash: txHash(at.block, at.tx ?? 0) } }
}

export function sessionOpened(
  at: At,
  p: { sessionId: string; player?: string; horseId?: number; stake?: bigint },
): Sim {
  return {
    contract: 'PonyGame',
    event: 'LegacySessionOpened',
    ...meta(at),
    params: {
      sessionId: p.sessionId,
      player: (p.player ?? PLAYER) as `0x${string}`,
      horseId: BigInt(p.horseId ?? 2),
      stake: p.stake ?? STAKE,
      seed: hex32(0x5eed),
      openedAt: BigInt(timestampOf(at.block)),
      openedBlock: BigInt(blockAt(at.block)),
      rulesetHash: RULESET,
    },
  }
}

export function stakeLocked(at: At, p: { sessionId: string; player?: string; stake?: bigint }): Sim {
  const stake = p.stake ?? STAKE
  return {
    contract: 'PonyVault',
    event: 'StakeLocked',
    ...meta(at),
    params: {
      sessionId: p.sessionId,
      player: (p.player ?? PLAYER) as `0x${string}`,
      stake,
      maxPayout: stake * 3n,
      reserve: stake * 2n,
    },
  }
}

/** openSession: PonyGame logs SessionOpened, then PonyVault.lockStake logs StakeLocked, same tx. */
export function openSession(block: number, p: { sessionId: string; player?: string; horseId?: number; stake?: bigint }): Sim[] {
  return [sessionOpened({ block, logIndex: 0 }, p), stakeLocked({ block, logIndex: 1 }, p)]
}

export function cardChosen(
  at: At,
  p: { sessionId: string; checkpoint: number; cardId: number; refreshSlots?: number[]; txSec: number; player?: string },
): Sim {
  return {
    contract: 'PonyGame',
    event: 'CardChosen',
    ...meta(at),
    params: {
      sessionId: p.sessionId,
      player: (p.player ?? PLAYER) as `0x${string}`,
      checkpoint: BigInt(p.checkpoint),
      cardId: BigInt(p.cardId),
      refreshSlots: (p.refreshSlots ?? []).map(BigInt),
      txSec: BigInt(p.txSec),
      blockNumber: BigInt(blockAt(at.block)),
    },
  }
}

export function anchorSealed(at: At, p: { sessionId: string; sourceBlock: number }): Sim {
  return {
    contract: 'PonyGame',
    event: 'RandomAnchorSealed',
    ...blockMeta(at),
    params: { sessionId: p.sessionId, sourceBlock: BigInt(blockAt(p.sourceBlock)), anchor: anchorOf(p.sourceBlock) },
  }
}

export function sessionSettled(
  at: At,
  p: {
    sessionId: string
    player?: string
    rawOrder: number[]
    settlementOrder: number[]
    rank: number
    payout: bigint
    acquired: [number, number, number]
  },
): Sim {
  return {
    contract: 'PonyGame',
    event: 'SessionSettled',
    ...meta(at),
    params: {
      sessionId: p.sessionId,
      player: (p.player ?? PLAYER) as `0x${string}`,
      finishTime: [61_000n, 62_500n, 60_250n, 63_000n, 64_750n],
      rawOrder: p.rawOrder.map(BigInt),
      settlementOrder: p.settlementOrder.map(BigInt),
      playerSettlementRank: BigInt(p.rank),
      payout: p.payout,
      digest: hex32(0xd1),
      acquired: p.acquired.map(BigInt),
    },
  }
}

export function sessionForfeited(at: At, p: { sessionId: string; player?: string; stake?: bigint; reason: number }): Sim {
  return {
    contract: 'PonyGame',
    event: 'SessionForfeited',
    ...meta(at),
    params: {
      sessionId: p.sessionId,
      player: (p.player ?? PLAYER) as `0x${string}`,
      stake: p.stake ?? STAKE,
      reason: BigInt(p.reason),
    },
  }
}

export function stakeSettled(at: At, p: { sessionId: string; player?: string; payout: bigint }): Sim {
  return {
    contract: 'PonyVault',
    event: 'StakeSettled',
    ...meta(at),
    params: { sessionId: p.sessionId, player: (p.player ?? PLAYER) as `0x${string}`, payout: p.payout },
  }
}

type VaultFlow = 'Deposited' | 'Withdrawn'
export function playerFlow(at: At, event: VaultFlow, player: string, amount: bigint): Sim {
  return { contract: 'PonyVault', event, ...meta(at), params: { player: player as `0x${string}`, amount } }
}

export function houseFunded(at: At, funder: string, amount: bigint): Sim {
  return { contract: 'PonyVault', event: 'HouseFunded', ...meta(at), params: { funder: funder as `0x${string}`, amount } }
}

export function houseWithdrawn(at: At, recipient: string, amount: bigint): Sim {
  return {
    contract: 'PonyVault',
    event: 'HouseWithdrawn',
    ...meta(at),
    params: { recipient: recipient as `0x${string}`, amount },
  }
}

export async function run(indexer: TestIndexer, simulate: Sim[]): Promise<void> {
  await indexer.process({ chains: { [CHAIN_ID]: { simulate } } })
}
