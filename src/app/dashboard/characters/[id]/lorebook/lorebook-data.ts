import type { CharacterModule } from '@/types/database.types'
import type { LorebookEntry } from '@/types/lorebook.types'

type CharacterModuleBase = Pick<CharacterModule, 'id' | 'enabled' | 'priority' | 'module_id'>

type ModuleLorebookRelation = {
  id: string
  name: string
  lorebook: LorebookEntry[]
}

export type CharacterModuleWithLorebook = CharacterModuleBase & {
  modules: ModuleLorebookRelation | null
}

export type CharacterLorebookEntry = LorebookEntry & {
  moduleId: string
  moduleName: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isLorebookEntry(value: unknown): value is LorebookEntry {
  return isRecord(value) && typeof value.key === 'string' && typeof value.content === 'string'
}

function normalizeModuleLorebookRelation(value: unknown): ModuleLorebookRelation | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    lorebook: Array.isArray(value.lorebook) ? value.lorebook.filter(isLorebookEntry) : [],
  }
}

export function normalizeCharacterModulesWithLorebook(
  value: unknown,
): CharacterModuleWithLorebook[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((row) => {
    if (
      !isRecord(row) ||
      typeof row.id !== 'string' ||
      typeof row.enabled !== 'boolean' ||
      typeof row.priority !== 'number' ||
      typeof row.module_id !== 'string'
    ) {
      return []
    }

    return [
      {
        id: row.id,
        enabled: row.enabled,
        priority: row.priority,
        module_id: row.module_id,
        modules: normalizeModuleLorebookRelation(row.modules),
      },
    ]
  })
}

export function buildCharacterLorebookEntries(
  characterModules: CharacterModuleWithLorebook[],
): CharacterLorebookEntry[] {
  const entries: CharacterLorebookEntry[] = []

  for (const characterModule of characterModules) {
    if (!characterModule.modules) {
      continue
    }

    for (const entry of characterModule.modules.lorebook) {
      entries.push({
        ...entry,
        moduleId: characterModule.module_id,
        moduleName: characterModule.modules.name,
      })
    }
  }

  return entries
}
