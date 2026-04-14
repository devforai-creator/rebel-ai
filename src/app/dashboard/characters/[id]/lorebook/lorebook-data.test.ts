import { describe, expect, it } from 'vitest'

import {
  buildCharacterLorebookEntries,
  normalizeCharacterModulesWithLorebook,
} from './lorebook-data'

describe('normalizeCharacterModulesWithLorebook', () => {
  it('keeps valid module rows and sanitizes invalid lorebook entries', () => {
    const result = normalizeCharacterModulesWithLorebook([
      {
        id: 'link-1',
        enabled: true,
        priority: 10,
        module_id: 'module-1',
        modules: {
          id: 'module-1',
          name: 'Module One',
          lorebook: [{ key: 'hero', content: 'Hero entry', alwaysActive: true }, { key: 'broken' }],
        },
      },
      {
        id: 'link-2',
        enabled: false,
        priority: 5,
        module_id: 'module-2',
        modules: { bad: 'shape' },
      },
      {
        id: 'bad-row',
        enabled: 'yes',
        priority: 0,
        module_id: 'module-3',
      },
    ])

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      id: 'link-1',
      module_id: 'module-1',
      modules: {
        id: 'module-1',
        name: 'Module One',
      },
    })
    expect(result[0].modules?.lorebook).toEqual([
      { key: 'hero', content: 'Hero entry', alwaysActive: true },
    ])
    expect(result[1].modules).toBeNull()
  })
})

describe('buildCharacterLorebookEntries', () => {
  it('adds module metadata to sanitized lorebook entries', () => {
    const modules = normalizeCharacterModulesWithLorebook([
      {
        id: 'link-1',
        enabled: true,
        priority: 10,
        module_id: 'module-1',
        modules: {
          id: 'module-1',
          name: 'Module One',
          lorebook: [
            {
              key: 'hero',
              content: 'Hero entry',
              folder: 'world',
            },
          ],
        },
      },
      {
        id: 'link-2',
        enabled: true,
        priority: 1,
        module_id: 'module-2',
        modules: null,
      },
    ])

    expect(buildCharacterLorebookEntries(modules)).toEqual([
      {
        key: 'hero',
        content: 'Hero entry',
        folder: 'world',
        moduleId: 'module-1',
        moduleName: 'Module One',
      },
    ])
  })
})
