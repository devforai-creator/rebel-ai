import { coverageConfigDefaults, defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'threads',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/tests/mocks/**',
        'tests/__mocks__/**',
        // Keep the production gate focused on runtime-bearing logic while the
        // chat-detail client shells are still being decomposed in P2.
        'src/app/dashboard/chats/[id]/hooks/**',
        'src/app/dashboard/chats/[id]/components/**',
        'src/app/dashboard/chats/[id]/*.tsx',
      ],
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 90,
        lines: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Mock server-only package for unit tests
      'server-only': path.resolve(__dirname, './tests/__mocks__/server-only.ts'),
    },
  },
})
