import { indexer } from 'envio'
import { hexId, newPlayer, small } from '../model.ts'

indexer.onEvent({ contract: 'PonyRewards', event: 'CollectibleGranted' }, async ({ event, context }) => {
  const ledger = event.srcAddress
  const sessionId = hexId(event.params.sessionId)
  const id = `${ledger}_${sessionId}`
  if (await context.CollectibleGrant.get(id)) return
  const assetKind = small(event.params.assetKind) === 0 ? 'RARE_CARD' : 'PONY'
  const assetId = small(event.params.assetId)
  const player = event.params.player
  const ownershipId = `${ledger}_${player}_${assetKind}_${assetId}`
  const [owner, existing] = await Promise.all([context.Player.get(player), context.CollectibleOwnership.get(ownershipId)])
  context.Player.set(owner ?? newPlayer(player))
  context.CollectibleGrant.set({ id, ledger, sessionId, player_id: player, assetKind, assetId,
    blockNumber: BigInt(event.block.number), timestamp: BigInt(event.block.timestamp), txHash: event.transaction.hash })
  if (!existing) context.CollectibleOwnership.set({ id: ownershipId, ledger, player_id: player, assetKind, assetId, grant_id: id })
})
