#!/usr/bin/env node
/**
 * Copies the event ABI of PonyGame and PonyVault from the Foundry artifacts into abis/.
 *
 * Only works inside the Ponygogogo monorepo (it reads ../out/, produced by `forge build`); the
 * published indexer repo carries the committed abis/ files. `--check` exits 1 when abis/ has
 * drifted from the artifacts, so a contract change cannot silently stop events from decoding.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..')
const artifacts = join(pkg, '..', 'out')
const contracts = ['PonyGame', 'PonyVault']
const check = process.argv.includes('--check')

let drift = false
for (const name of contracts) {
  const artifact = join(artifacts, `${name}.sol`, `${name}.json`)
  if (!existsSync(artifact)) {
    console.error(`missing ${artifact}: run \`forge build\` in the monorepo root first`)
    process.exit(2)
  }
  const events = JSON.parse(readFileSync(artifact, 'utf8'))
    .abi.filter((entry) => entry.type === 'event')
    .sort((a, b) => a.name.localeCompare(b.name))
  const next = `${JSON.stringify(events, null, 2)}\n`
  const target = join(pkg, 'abis', `${name}.json`)
  const current = existsSync(target) ? readFileSync(target, 'utf8') : ''
  if (current === next) continue
  if (check) {
    console.error(`abis/${name}.json differs from out/${name}.sol/${name}.json`)
    drift = true
  } else {
    writeFileSync(target, next)
    console.log(`wrote abis/${name}.json (${events.length} events)`)
  }
}
if (drift) process.exit(1)
if (check) console.log('abis/ matches the Foundry artifacts')
