import { describe, expect, it } from 'vitest'
import type { SanitizedMessage, ServerSupabaseClient } from '@/lib/chat-summaries/types'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import { computeLorebookEntryFingerprint } from './override-identity'
import {
  buildLorebookDynamicContext,
  renderActiveLorebookBlock,
  type LorebookRuntimeEntry,
} from './runtime'

describe('renderActiveLorebookBlock', () => {
  it('renders active, pinned, and always-active entries in deterministic order', () => {
    const entries: LorebookRuntimeEntry[] = [
      {
        moduleId: 'module-b',
        key: 'zeta',
        content: 'Pinned lore',
        insertorder: 10,
      },
      {
        moduleId: 'module-a',
        key: 'magic',
        content: 'Keyword lore',
        insertorder: 10,
      },
      {
        moduleId: 'module-c',
        key: 'always',
        content: 'Always lore',
        insertorder: 1,
        alwaysActive: true,
      },
      {
        moduleId: 'module-d',
        key: 'hidden',
        content: 'Disabled lore',
        insertorder: 99,
      },
    ]

    const overrideMap = new Map<string, boolean>([
      [`v2:module-b:${computeLorebookEntryFingerprint('module-b', entries[0])}`, true],
      [`v2:module-d:${computeLorebookEntryFingerprint('module-d', entries[3])}`, false],
    ])

    const result = renderActiveLorebookBlock({
      entries,
      overrideMap,
      chatHistory: [{ role: 'user', content: 'Can you explain magic?' }],
    })

    expect(result).toBe(
      '=== Active Lorebook Entries ===\nKeyword lore\n\nPinned lore\n\nAlways lore',
    )
  })

  it('uses higher module priority as the final tiebreaker before module id', () => {
    const entries: LorebookRuntimeEntry[] = [
      {
        moduleId: 'module-z',
        modulePriority: 1,
        key: 'same',
        content: 'Low priority lore',
        insertorder: 10,
        comment: 'tie',
      },
      {
        moduleId: 'module-a',
        modulePriority: 5,
        key: 'same',
        content: 'High priority lore',
        insertorder: 10,
        comment: 'tie',
      },
    ]

    const result = renderActiveLorebookBlock({
      entries,
      overrideMap: new Map(),
      chatHistory: [{ role: 'user', content: 'same' }],
    })

    expect(result).toBe('=== Active Lorebook Entries ===\nHigh priority lore\n\nLow priority lore')
  })
})

describe('buildLorebookDynamicContext', () => {
  it('loads lorebook entries and applies chat-scoped overrides', async () => {
    const pinnedEntry = {
      key: 'secret',
      content: 'Pinned lore',
      insertorder: 5,
    }
    const disabledEntry = {
      key: 'blocked',
      content: 'Blocked lore',
      insertorder: 8,
    }

    const supabase = createSupabaseMock({
      tables: {
        character_modules: {
          rows: [
            {
              character_id: 'char-1',
              module_id: 'module-1',
              enabled: true,
              modules: {
                id: 'module-1',
                lorebook: [
                  {
                    key: 'magic',
                    content: 'Keyword lore',
                    insertorder: 10,
                  },
                  pinnedEntry,
                  disabledEntry,
                ],
              },
            },
          ],
        },
        lorebook_overrides_v2: {
          rows: [
            {
              chat_id: 'chat-1',
              module_id: 'module-1',
              entry_fingerprint: computeLorebookEntryFingerprint('module-1', {
                ...pinnedEntry,
                mode: 'normal',
              }),
              enabled: true,
            },
            {
              chat_id: 'chat-1',
              module_id: 'module-1',
              entry_fingerprint: computeLorebookEntryFingerprint('module-1', {
                ...disabledEntry,
                mode: 'normal',
              }),
              enabled: false,
            },
          ],
        },
        lorebook_overrides: {
          rows: [],
        },
      },
    }) as unknown as ServerSupabaseClient

    const result = await buildLorebookDynamicContext({
      supabase,
      chatId: 'chat-1',
      characterId: 'char-1',
      chatHistory: [{ role: 'user', content: 'Tell me about magic' }] satisfies SanitizedMessage[],
    })

    expect(result).toBe('=== Active Lorebook Entries ===\nKeyword lore\n\nPinned lore')
  })

  it('loads character modules in descending priority order before extracting lorebook entries', async () => {
    const supabase = createSupabaseMock({
      tables: {
        character_modules: {
          rows: [
            {
              character_id: 'char-1',
              module_id: 'module-low',
              enabled: true,
              priority: 1,
              modules: {
                id: 'module-low',
                lorebook: [
                  {
                    key: 'same',
                    content: 'Low priority lore',
                    insertorder: 10,
                    comment: 'tie',
                  },
                ],
              },
            },
            {
              character_id: 'char-1',
              module_id: 'module-high',
              enabled: true,
              priority: 5,
              modules: {
                id: 'module-high',
                lorebook: [
                  {
                    key: 'same',
                    content: 'High priority lore',
                    insertorder: 10,
                    comment: 'tie',
                  },
                ],
              },
            },
          ],
        },
        lorebook_overrides_v2: {
          rows: [],
        },
        lorebook_overrides: {
          rows: [],
        },
      },
    }) as unknown as ServerSupabaseClient

    const result = await buildLorebookDynamicContext({
      supabase,
      chatId: 'chat-1',
      characterId: 'char-1',
      chatHistory: [{ role: 'user', content: 'same' }] satisfies SanitizedMessage[],
    })

    expect(result).toBe('=== Active Lorebook Entries ===\nHigh priority lore\n\nLow priority lore')
  })
})
