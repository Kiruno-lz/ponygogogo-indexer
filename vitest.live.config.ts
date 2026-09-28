import { defineConfig } from 'vitest/config'

/** Live smoke run against Monad Testnet HyperSync; needs ENVIO_API_TOKEN (see README). */
export default defineConfig({
  test: {
    include: ['test/live/**/*.live.ts'],
    testTimeout: 120_000,
  },
})
