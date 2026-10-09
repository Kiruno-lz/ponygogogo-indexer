# Ponygogogo indexer

Envio HyperIndex 3.12.1 read model for Ponygogogo v0.1 on Monad Testnet (10143). It provides reorg-safe history and statistics; RPC/contracts remain authoritative for funds and session state.

`config.yaml` tracks the current PonyGame and PonyVault from block 69477594. The Game's RewardsBound event discovers PonyRewards. ABIs are copied from current Foundry artifacts by `scripts/sync-abis.mjs`; no historical ABI or event alias is accepted. SessionOpened includes a five-pony roster; horse statistics use pony identity rather than race slot.

Entities cover sessions, choices, sealed anchors, house funding, locked/settled stakes, collectible grants and ownership. Handlers keep no state outside Envio's entity store, so reorg rollback recomputes aggregates from canonical events. Player deposit/withdrawal aggregates and Vault pause history are absent because the current Vault has no such interfaces.

```sh
pnpm install --frozen-lockfile
pnpm codegen
pnpm typecheck
pnpm test
node scripts/sync-abis.mjs --check
```

`pnpm smoke` processes the current deployment's real HyperSync blocks and checks bindings, roster and settlement. It requires ENVIO_API_TOKEN. Envio Cloud provides its own HyperSync access; browser history uses the deployed public GraphQL endpoint with the real website origin.

After changing current contract addresses, update config.yaml, deployment fixtures and the live smoke range together, regenerate types, run tests, then publish. Cloud activation and a live GraphQL query are deployment evidence; offline handler tests alone are insufficient.
