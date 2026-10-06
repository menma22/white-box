import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['artifactreview/strict-20261006/shutdown-heartbeat-check/probe.test.ts'],
    maxWorkers: 1,
    minWorkers: 1,
  },
})
