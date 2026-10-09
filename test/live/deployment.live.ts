/** Current v0.1 deployment and real paid-session logs, processed through the production handlers. */
import { expect, it } from 'vitest'
import { createTestIndexer } from 'envio'
import { CHAIN_ID, GAME, MON, RULESET, VAULT } from '../fixtures.ts'

const REWARDS = '0xaa4181704974A86D4964f6e6f34Ed8Af570882b7'
const SESSION = '0x383db10ddb853045050bcfa964106e480d30e3559bef2250f53072d0498f4799'
const PLAYER = '0x8F283d1Bb30c13c2cEeE1183a60e213940200e87'
const OPEN_TX = '0xf369f9ae356029b101512af3a115c0c79cf9ebe5390923d89cd21a9ec7cb242f'
const SETTLE_TX = '0x35fa3bd06011db28eadcc1b9fb23d2afa64cdfdf797bcf1598df681f001b24fa'
const DIGEST = '0xf0d4f0678a164da22636898a65bd6134ddac45c4db3fa9c1d4f1b87b66e5a793'

it('indexes current bindings, house funding, roster, choices and settlement from real HyperSync blocks', async () => {
  if (!process.env.ENVIO_API_TOKEN) throw new Error('ENVIO_API_TOKEN is required for the live smoke run')
  const indexer = createTestIndexer()
  await indexer.process({ chains: { [CHAIN_ID]: { startBlock: 69_477_594, endBlock: 69_479_201 } } })
  expect(await indexer.GameStat.getOrThrow(GAME)).toMatchObject({
    vault: VAULT, rewards: REWARDS, entryPaused: false, sessionsOpened: 1, sessionsSettled: 1, totalPaidOut: 0n,
  })
  expect(await indexer.VaultStat.getOrThrow(VAULT)).toMatchObject({
    houseFunded: 30n * MON, houseFundCount: 1, openStake: 0n, openReserve: 0n, totalPayout: 0n,
  })
  expect(await indexer.Session.getOrThrow(SESSION)).toMatchObject({
    game: GAME, player_id: PLAYER, roster: [0,1,2,3,4], horseId: 2, rulesetHash: RULESET,
    stake: 3n * MON / 10n, openedBlock: 69_478_928n, openTx: OPEN_TX, state: 'SETTLED',
    acquired: [5,3,0], playerSettlementRank: 5, payout: 0n, digest: DIGEST, closeTx: SETTLE_TX,
  })
  expect(await indexer.Choice.getAll()).toHaveLength(2)
  expect(await indexer.CollectibleGrant.getAll()).toEqual([])
})
