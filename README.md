# Ponygogogo paid-race indexer

Envio HyperIndex (`envio` 3.12.1) indexer for PonyGame (session protocol v2) and PonyVault on Monad
Testnet (chain 10143), hosted on the free Envio Cloud Development plan.

**This is a read model, not fund state.** Every row is rebuilt from canonical contract events and can
lag, be rolled back on a reorg, or vanish when the free deployment is recycled. Balances, locks,
whether a session is still open and what it pays are always read from the contracts over RPC. The
browser only uses this indexer to show history and statistics.

## Layout

| Path | Role |
| --- | --- |
| `config.yaml` | Contracts, events, chain, start block, HyperSync endpoint, reorg rollback |
| `schema.graphql` | Entities (see below); becomes the GraphQL API |
| `abis/` | Event ABIs copied from the Foundry artifacts by `scripts/sync-abis.mjs` |
| `src/handlers/PonyGame.ts`, `src/handlers/PonyVault.ts` | Event handlers (auto-discovered) |
| `src/model.ts` | Pure rules shared by the handlers (ids, defaults, rank and choice resolution) |
| `test/*.test.ts` | Offline suite: `createTestIndexer()` with simulated events |
| `test/live/*.live.ts` | Live smoke run against Monad Testnet HyperSync (needs `ENVIO_API_TOKEN`) |

## Entities

| Entity | Key | Contents |
| --- | --- | --- |
| `Session` | sessionId | player, horse, stake, seed, ruleset, T0/open block/tx, `state` `OPEN`/`SETTLED`/`FORFEITED`, sealed open anchor, submission counts, and once closed: `finishTime[5]`, `rawOrder`, `settlementOrder`, `playerSettlementRank`, `playerRawRank`, `acquired[3]`, `payout`, `net`, `digest`, `forfeitReason`, close block/time/tx |
| `Choice` | sessionId-checkpoint | one `CardChosen` submission: card (0 = forfeit), refresh slots, `txSec`, block/tx, sealed anchor; `acquiredCardId` and `effective` are filled from `SessionSettled.acquired` |
| `Player` | checksummed address (the sma-b) | sessions opened/settled/forfeited, `settlementRankCounts[5]`, staked, paid out, forfeited, `net`, deposits and withdrawals |
| `HorseStat` | horseId 0..4 | picked, raced, physical wins (`rawOrder[0]`), settlement wins (`settlementOrder[0]`), wins when backed |
| `CardStat` | cardId 1..26 | submitted, effective, acquired (including cards the rules picked automatically) |
| `StakeLock` | sessionId | Vault-side lock: stake, max payout, reserve, `LOCKED`/`SETTLED`, payout |
| `VaultTransfer` | chain_block_logIndex | each deposit, withdrawal, house funding and house withdrawal |
| `VaultStat` | Vault address | event-derived totals: deposits, withdrawals, house funded/withdrawn, stake locked, open stake/reserve, payouts, house result, pause flag |
| `GameStat` | PonyGame address | bound Vault, pause flag, sessions opened/settled/forfeited, staked, paid out |

Semantics worth knowing:

- **v2 has no refunds.** A lost random anchor (`reason` 1) or an owner-closed solver fault (`reason` 2)
  emits `SessionForfeited`: the session closes with payout 0 and `net = -stake`, and the Vault emits
  `StakeSettled(payout 0)`. Forfeited sessions were never solved, so their choices keep `effective: null`.
- **A choice is a submission.** `effective` is `acquiredCardId == cardId` after settlement. An invalid
  submission counts as no choice, and the rules may then acquire another card or none.
- **Aggregates move only on guarded transitions:** new session, new choice, OPEN → closed, first seal
  of an anchor, new lock, LOCKED → SETTLED, new transfer log. An event delivered twice changes nothing.
  Game and Vault handlers never read each other's rows, so log order inside a transaction does not matter.
- **Events for a session never seen opening are logged and skipped.** A history read model should not
  stop indexing over one bad row.
- **Reorgs:** HyperIndex's default `rollback_on_reorg: true` with the default `max_reorg_depth` of 200
  blocks on this chain. HyperSync guarantees reorg detection. On a reorg, every row written from the
  orphaned blocks is rolled back and the canonical blocks are replayed, so all totals are recomputed
  from canonical events. The handlers have no external side effects, so nothing escapes the rollback.
- **Aggregations are precomputed.** Envio Cloud does not expose GraphQL `_aggregate` queries.

## Local development

Requirements: Node.js ≥ 22 (24+ recommended) and pnpm (the build is checked against pnpm 10.32.0 and
12.x). Docker is only needed for `pnpm dev` (local Postgres + Hasura). Codegen and tests don't need it.

```bash
pnpm install
pnpm codegen          # writes .envio/types.d.ts from config.yaml + schema.graphql
pnpm typecheck
pnpm test             # offline, simulated events, no token needed
pnpm abis:check       # monorepo only: abis/ still matches ../out (run `forge build` first)
```

### Live smoke run (optional)

`pnpm smoke` indexes the real deployment blocks through HyperSync and checks the rows against the
logs in the deployment broadcast. It needs a HyperSync token from https://envio.dev/app/api-tokens.
Inside the monorepo, read the token from the root `.env` without printing it:

```bash
ENVIO_API_TOKEN="$(sed -n 's/^ENVIO_API_TOKEN=//p' ../.env | tr -d '"')" pnpm smoke
```

It takes about 3 s. It fails with a clear message when the token is missing.

## After the v2 redeployment

1. In the monorepo root, run `forge build`. Then, in `envio/`, run `pnpm abis`, then `pnpm abis:check`.
   `abis/` currently holds the v2 event set written from the protocol spec, so check the diff.
2. In `config.yaml`, set both contract addresses and `start_block`. Use the PonyGame deploy block (or
   the earlier of the two deploy blocks), and remove the `//TODO` placeholder note.
3. Point `test/fixtures.ts` (`GAME`, `VAULT`) and the real-log fixtures in `test/vault.test.ts` and
   `test/live/deployment.live.ts` at the new deployment's logs.
4. Run `pnpm codegen && pnpm typecheck && pnpm test && pnpm smoke`.

## Publishing to Envio Cloud

Envio Cloud deploys from a GitHub repository no larger than 100 MB. The monorepo is larger, so this
directory is published as the root of its own repository, `Kiruno-lz/ponygogogo-indexer`.

### 1. Publish the directory as a repository

`git subtree split` works on committed history, so commit `envio/` in the monorepo first.

```bash
# once: create the public repository
gh repo create Kiruno-lz/ponygogogo-indexer --public \
  --description "Envio HyperIndex read model for Ponygogogo paid races on Monad Testnet"

# every release: split envio/ into its own history and push it as the repository root
git subtree split --prefix envio -b envio-publish
git push git@github.com:Kiruno-lz/ponygogogo-indexer.git envio-publish:main
git branch -D envio-publish
```

### 2. Connect Envio Cloud

1. Sign in at https://envio.dev/app with GitHub and select the organisation.
2. Install the **Envio Deployments** GitHub App and give it access to `ponygogogo-indexer`.
3. **Add Indexer** with:
   - Indexer Directory (root directory): `/`, because the repository root is this directory
   - Config File: `config.yaml`
   - Git Release Branch: `main`
   - Plan: Development (free)
   - Environment variables: none. Cloud deployments get HyperSync access without `ENVIO_API_TOKEN`.
4. Push to `main`, or deploy the commit from **Recent Commits**, and wait for the historical sync.
5. Copy the production GraphQL endpoint (`https://…/v1/graphql`) into the monorepo's `.env` as
   `VITE_ENVIO_GRAPHQL_URL`. It is a build-time variable, so rebuild the site.

### Cloud rules this package follows

- `envio` is pinned to an exact version (`3.12.1`). Cloud rejects ranges, `latest` and `workspace:*`.
- Cloud resolves dependencies itself and ignores `pnpm-lock.yaml`, so every dependency is pinned
  exactly. An install from this directory without the lockfile under pnpm 10.32.0 was verified.
- Cloud skips dotfiles/dot-folders (except `.npmrc`) and folders named `generated` or `node_modules`.
  Nothing the build needs lives there: `.envio/` is regenerated by codegen.
- All imports stay inside this directory.

### Development plan limits

- 3 indexers per organisation and 3 deployments per indexer. Each push is a new deployment that
  re-indexes from `start_block`, so delete old deployments to make room.
- Deployments are deleted after 30 days or beyond 20 GB.
- Soft limits: 100,000 events, 5 GB, or 7 days without queries. Breaching one starts a 7-day grace
  period, then 3 days read-only, then deletion.
- No uptime or durability guarantee. That is acceptable only because this is a read model.

## Query example

The browser client (`src/chain/history.ts` in the monorepo) sends:

```graphql
query RecentSessions($player: String!, $limit: Int!) {
  Session(where: { player_id: { _eq: $player } }, order_by: { openedBlock: desc }, limit: $limit) {
    id horseId stake state openedAt openedBlock openTx
    playerSettlementRank playerRawRank payout net forfeitReason closedAt closeTx
    choices { checkpoint cardId effective }
  }
  _meta { chainId progressBlock isReady }
}
```

`BigInt` columns arrive as decimal strings. Addresses are EIP-55 checksummed.
