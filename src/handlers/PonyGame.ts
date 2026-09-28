/**
 * PonyGame session protocol v2 → Session / Choice / Player / HorseStat / CardStat / GameStat.
 *
 * Every aggregate moves only on a guarded transition (a new Session, a new Choice, OPEN → SETTLED,
 * OPEN → FORFEITED, a first seal of an anchor), so an event delivered twice changes nothing the
 * second time. Events that reference an unknown session are logged and skipped instead of crashing
 * the indexer: this is a history read model, and the contracts stay the authority.
 */
import { indexer, type Choice, type Session } from 'envio'
import {
  CHECKPOINTS,
  HORSE_COUNT,
  acquiredAt,
  bumpRank,
  choiceId,
  hexId,
  isEffective,
  newCardStat,
  newGameStat,
  newHorseStat,
  newPlayer,
  rankIn,
  settleHorse,
  small,
  smallList,
} from '../model.ts'

const CHECKPOINT_NUMBERS = Array.from({ length: CHECKPOINTS }, (_, i) => i + 1)
const HORSE_IDS = Array.from({ length: HORSE_COUNT }, (_, i) => i)

indexer.onEvent(
  { contract: 'PonyGame', event: 'SessionOpened' },
  async ({ event, context }) => {
    const id = hexId(event.params.sessionId)
    const horseId = small(event.params.horseId)
    const gameId = event.srcAddress
    const [existing, player, horse, game] = await Promise.all([
      context.Session.get(id),
      context.Player.get(event.params.player),
      context.HorseStat.get(String(horseId)),
      context.GameStat.get(gameId),
    ])
    if (existing) return

    const stake = event.params.stake
    context.Session.set({
      id,
      game: gameId,
      player_id: event.params.player,
      horseId,
      stake,
      seed: event.params.seed,
      rulesetHash: event.params.rulesetHash,
      openedAt: event.params.openedAt,
      openedBlock: event.params.openedBlock,
      openTx: event.transaction.hash,
      state: 'OPEN',
      openAnchor: undefined,
      anchorsSealed: 0,
      choiceCount: 0,
      forfeitSubmissions: 0,
      lastCheckpoint: 0,
      finishTime: undefined,
      rawOrder: undefined,
      settlementOrder: undefined,
      playerSettlementRank: undefined,
      playerRawRank: undefined,
      acquired: undefined,
      effectiveChoices: undefined,
      payout: undefined,
      net: undefined,
      digest: undefined,
      forfeitReason: undefined,
      closedAt: undefined,
      closedBlock: undefined,
      closeTx: undefined,
    })

    const p = player ?? newPlayer(event.params.player)
    context.Player.set({ ...p, sessionsOpened: p.sessionsOpened + 1, totalStaked: p.totalStaked + stake })
    const h = horse ?? newHorseStat(horseId)
    context.HorseStat.set({ ...h, picked: h.picked + 1 })
    const g = game ?? newGameStat(gameId)
    context.GameStat.set({ ...g, sessionsOpened: g.sessionsOpened + 1, totalStaked: g.totalStaked + stake })
  },
)

indexer.onEvent(
  { contract: 'PonyGame', event: 'CardChosen' },
  async ({ event, context }) => {
    const sessionId = hexId(event.params.sessionId)
    const checkpoint = small(event.params.checkpoint)
    const cardId = small(event.params.cardId)
    const id = choiceId(sessionId, checkpoint)
    const [session, existing, card] = await Promise.all([
      context.Session.get(sessionId),
      context.Choice.get(id),
      cardId > 0 ? context.CardStat.get(String(cardId)) : Promise.resolve(undefined),
    ])
    if (!session) {
      context.log.error(`CardChosen for unknown session ${sessionId} at block ${event.block.number}; skipped`)
      return
    }
    if (existing) return

    context.Choice.set({
      id,
      session_id: sessionId,
      player_id: event.params.player,
      checkpoint,
      cardId,
      forfeit: cardId === 0,
      refreshSlots: smallList(event.params.refreshSlots),
      txSec: small(event.params.txSec),
      blockNumber: event.params.blockNumber,
      timestamp: BigInt(event.block.timestamp),
      txHash: event.transaction.hash,
      anchor: undefined,
      acquiredCardId: undefined,
      effective: undefined,
    })
    context.Session.set({
      ...session,
      choiceCount: session.choiceCount + 1,
      forfeitSubmissions: session.forfeitSubmissions + (cardId === 0 ? 1 : 0),
      lastCheckpoint: Math.max(session.lastCheckpoint, checkpoint),
    })
    if (cardId > 0) {
      const c = card ?? newCardStat(cardId)
      context.CardStat.set({ ...c, submitted: c.submitted + 1 })
    }
  },
)

indexer.onEvent({ contract: 'PonyGame', event: 'RandomAnchorSealed' }, async ({ event, context }) => {
  const sessionId = hexId(event.params.sessionId)
  const [session, ...choices] = await Promise.all([
    context.Session.get(sessionId),
    ...CHECKPOINT_NUMBERS.map((checkpoint) => context.Choice.get(choiceId(sessionId, checkpoint))),
  ])
  if (!session) {
    context.log.error(`RandomAnchorSealed for unknown session ${sessionId} at block ${event.block.number}; skipped`)
    return
  }
  const source = event.params.sourceBlock
  if (source === session.openedBlock) {
    if (session.openAnchor !== undefined) return
    context.Session.set({ ...session, openAnchor: event.params.anchor, anchorsSealed: session.anchorsSealed + 1 })
    return
  }
  const choice = choices.find((c): c is Choice => c !== undefined && c.blockNumber === source)
  if (!choice) {
    context.log.warn(`RandomAnchorSealed for session ${sessionId} names block ${source}, which has no indexed choice`)
    return
  }
  if (choice.anchor !== undefined) return
  context.Choice.set({ ...choice, anchor: event.params.anchor })
  context.Session.set({ ...session, anchorsSealed: session.anchorsSealed + 1 })
})

indexer.onEvent(
  { contract: 'PonyGame', event: 'SessionSettled' },
  async ({ event, context }) => {
    const sessionId = hexId(event.params.sessionId)
    const acquired = smallList(event.params.acquired)
    const [session, player, game, ...choices] = await Promise.all([
      context.Session.get(sessionId),
      context.Player.get(event.params.player),
      context.GameStat.get(event.srcAddress),
      ...CHECKPOINT_NUMBERS.map((checkpoint) => context.Choice.get(choiceId(sessionId, checkpoint))),
    ])
    if (!session) {
      context.log.error(`SessionSettled for unknown session ${sessionId} at block ${event.block.number}; skipped`)
      return
    }
    if (session.state !== 'OPEN') return

    const submitted = choices.filter((c): c is Choice => c !== undefined)
    const resolved = submitted.map((choice) => {
      const acquiredCardId = acquiredAt(acquired, choice.checkpoint)
      return { ...choice, acquiredCardId, effective: isEffective(choice.cardId, acquiredCardId) }
    })
    const cardIds = [...new Set([...acquired, ...resolved.map((c) => c.cardId)].filter((id) => id > 0))]
    const [horses, cards] = await Promise.all([
      Promise.all(HORSE_IDS.map((horseId) => context.HorseStat.get(String(horseId)))),
      Promise.all(cardIds.map((cardId) => context.CardStat.get(String(cardId)))),
    ])

    const rawOrder = smallList(event.params.rawOrder)
    const settlementOrder = smallList(event.params.settlementOrder)
    const playerRank = small(event.params.playerSettlementRank)
    const payout = event.params.payout
    const net = payout - session.stake
    context.Session.set({
      ...session,
      state: 'SETTLED',
      finishTime: smallList(event.params.finishTime),
      rawOrder,
      settlementOrder,
      playerSettlementRank: playerRank,
      playerRawRank: rankIn(rawOrder, session.horseId),
      acquired,
      effectiveChoices: resolved.filter((c) => c.effective).length,
      payout,
      net,
      digest: event.params.digest,
      closedAt: BigInt(event.block.timestamp),
      closedBlock: BigInt(event.block.number),
      closeTx: event.transaction.hash,
    })
    for (const choice of resolved) context.Choice.set(choice)

    const p = player ?? newPlayer(event.params.player)
    context.Player.set({
      ...p,
      sessionsSettled: p.sessionsSettled + 1,
      settlementRankCounts: bumpRank(p.settlementRankCounts, playerRank),
      totalPaidOut: p.totalPaidOut + payout,
      net: p.net + net,
    })
    const g = game ?? newGameStat(event.srcAddress)
    context.GameStat.set({ ...g, sessionsSettled: g.sessionsSettled + 1, totalPaidOut: g.totalPaidOut + payout })

    const race = { rawOrder, settlementOrder, playerHorseId: session.horseId, playerRank }
    HORSE_IDS.forEach((horseId, i) => {
      context.HorseStat.set(settleHorse(horses[i] ?? newHorseStat(horseId), race))
    })
    cardIds.forEach((cardId, i) => {
      const c = cards[i] ?? newCardStat(cardId)
      context.CardStat.set({
        ...c,
        acquired: c.acquired + acquired.filter((id) => id === cardId).length,
        effective: c.effective + resolved.filter((r) => r.effective && r.cardId === cardId).length,
      })
    })
  },
)

indexer.onEvent(
  { contract: 'PonyGame', event: 'SessionForfeited' },
  async ({ event, context }) => {
    const sessionId = hexId(event.params.sessionId)
    const [session, player, game] = await Promise.all([
      context.Session.get(sessionId),
      context.Player.get(event.params.player),
      context.GameStat.get(event.srcAddress),
    ])
    if (!session) {
      context.log.error(`SessionForfeited for unknown session ${sessionId} at block ${event.block.number}; skipped`)
      return
    }
    if (session.state !== 'OPEN') return
    if (event.params.stake !== session.stake) {
      context.log.warn(`SessionForfeited stake ${event.params.stake} differs from opened stake ${session.stake} (${sessionId})`)
    }

    const forfeited: Session = {
      ...session,
      state: 'FORFEITED',
      payout: 0n,
      net: -session.stake,
      forfeitReason: small(event.params.reason),
      closedAt: BigInt(event.block.timestamp),
      closedBlock: BigInt(event.block.number),
      closeTx: event.transaction.hash,
    }
    context.Session.set(forfeited)
    const p = player ?? newPlayer(event.params.player)
    context.Player.set({
      ...p,
      sessionsForfeited: p.sessionsForfeited + 1,
      totalForfeited: p.totalForfeited + session.stake,
      net: p.net - session.stake,
    })
    const g = game ?? newGameStat(event.srcAddress)
    context.GameStat.set({ ...g, sessionsForfeited: g.sessionsForfeited + 1 })
  },
)

indexer.onEvent({ contract: 'PonyGame', event: 'VaultBound' }, async ({ event, context }) => {
  const game = (await context.GameStat.get(event.srcAddress)) ?? newGameStat(event.srcAddress)
  context.GameStat.set({ ...game, vault: event.params.vault })
})

indexer.onEvent({ contract: 'PonyGame', event: 'EntryPauseChanged' }, async ({ event, context }) => {
  const game = (await context.GameStat.get(event.srcAddress)) ?? newGameStat(event.srcAddress)
  context.GameStat.set({ ...game, entryPaused: event.params.paused, pauseChangedBlock: BigInt(event.block.number) })
})
