import { defineConfig } from 'vitest/config'

/** Offline suite: simulated events only, no network, no ENVIO_API_TOKEN. */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 5_000,
  },
})
