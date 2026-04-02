#!/usr/bin/env node
import('../dist/cli.js').catch((err) => {
  console.error('Failed to start im-cc:', err.message)
  process.exit(1)
})
