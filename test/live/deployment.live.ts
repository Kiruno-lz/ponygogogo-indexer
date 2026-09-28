/**
 * Live smoke run: indexes real blocks of the session protocol v2 redeployment from Monad Testnet
 * HyperSync and checks the rows against the on-chain logs (cast receipt): the deployment itself,
 * then the first paid session on it. Not part of `pnpm test`; run with `pnpm smoke` and
 * ENVIO_API_TOKEN set.
 */
import { describe, expect, it } from 'vitest'
import { createTestIndexer } from 'envio'
import { CHAIN_ID, DEPLOYER, GAME, MON, RULESET, VAULT } from '../fixtures.ts'

/** PonyGame creation block (config.yaml start_block) through the EntryPauseChanged that opens entries. */
const DEPLOY_FROM = 66_458_114
const DEPLOY_TO = 66_458_146
/** Through the settleSession block of the first paid session. */
const SESSION_TO = 66_459_230

/** All-timeout tier-1 session on horse 2 that finished last; no CardChosen was submitted. */
const SESSION_ID = '0xe77209bc7b062fef5f32011c454429121659ca372eaa47160d832c6bd61858e7'
const SESSION_PLAYER = '0x9C6Ed72Da67F20C34372a9BBd25E99a4AF6e6894'
const SESSION_STAKE = (MON * 3n) / 10n

async function indexRange(endBlock: number) {
  if (!process.env.ENVIO_API_TOKEN) throw new Error('ENVIO_API_TOKEN is required for the live smoke run')
  const indexer = createTestIndexer()
  await indexer.process({ chains: { [CHAIN_ID]: { startBlock: DEPLOY_FROM, endBlock } } })
  return indexer
}

describe('Monad Testnet HyperSync', () => {
  it('indexes VaultBound, HouseFunded and EntryPauseChanged from the v2 deployment', async () => {
    const indexer = await indexRange(DEPLOY_TO)

    expect(await indexer.GameStat.getOrThrow(GAME)).toMatchObject({
      vault: VAULT,
      entryPaused: false,
      pauseChangedBlock: 66_458_146n,
      sessionsOpened: 0,
    })
    expect(await indexer.VaultStat.getOrThrow(VAULT)).toMatchObject({ houseFunded: 3n * MON, houseFundCount: 1, entryPaused: false })
    expect(await indexer.VaultTransfer.getOrThrow(`${CHAIN_ID}_66458135_40`)).toMatchObject({
      kind: 'HOUSE_FUND',
      account: DEPLOYER,
      amount: 3n * MON,
      timestamp: 1_790_614_146n,
      txHash: '0x378f1428ed83b9e4e9cf80039039fde21f45ad67513524e0be887fceb12c8479',
    })
  })

  it('indexes the first paid session from its real SessionOpened, RandomAnchorSealed and SessionSettled logs', async () => {
    const indexer = await indexRange(SESSION_TO)

    expect(await indexer.Session.getOrThrow(SESSION_ID)).toEqual({
      id: SESSION_ID,
      game: GAME,
      player_id: SESSION_PLAYER,
      horseId: 2,
      stake: SESSION_STAKE,
      seed: '0xc4fa19d1992bf7f7167564f7492865d618b75f578394220b8c70dc0db2366881',
      rulesetHash: RULESET,
      openedAt: 1_790_614_358n,
      openedBlock: 66_458_826n,
      openTx: '0xda43f7ff44f0c7103a3dcdf7b4f5e014398ca9e01b185761e1c0bce0616b94f1',
      state: 'SETTLED',
      // settleSession seals the open block's anchor (log 2) before logging SessionSettled (log 3).
      openAnchor: '0x6c919262cc5d4d9978aef041043df330b13369e5bb1a7ec845a5ad3f219e3fd9',
      anchorsSealed: 1,
      choiceCount: 0,
      forfeitSubmissions: 0,
      lastCheckpoint: 0,
      finishTime: [63_850, 62_189, 63_889, 58_462, 59_885],
      rawOrder: [3, 4, 1, 0, 2],
      settlementOrder: [3, 4, 1, 0, 2],
      playerSettlementRank: 5,
      playerRawRank: 5,
      acquired: [0, 0, 0],
      effectiveChoices: 0,
      payout: 0n,
      net: -SESSION_STAKE,
      digest: '0x88a9f604551ae041d3a10d60eb302f0de9f891e871f6c9faf82e536ce9cbe327',
      forfeitReason: undefined,
      closedAt: 1_790_614_481n,
      closedBlock: 66_459_230n,
      closeTx: '0xc2272354ee3db0ff78ffd31b8635d76a2b55ac5810e51add9a8e3fc59ee4f1c4',
    })
    expect(await indexer.Choice.getAll()).toEqual([])
    expect(await indexer.GameStat.getOrThrow(GAME)).toEqual({
      id: GAME,
      vault: VAULT,
      entryPaused: false,
      pauseChangedBlock: 66_458_146n,
      sessionsOpened: 1,
      sessionsSettled: 1,
      sessionsForfeited: 0,
      totalStaked: SESSION_STAKE,
      totalPaidOut: 0n,
    })
  })
})
