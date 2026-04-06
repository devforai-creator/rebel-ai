import { createClient } from '@/lib/supabase/server'
import LorebookPanel from './LorebookPanel'
import type { LorebookEntry } from '@/types/risuai.types'
import {
  computeLorebookEntryFingerprint,
  getLorebookOverrideKeyV2,
} from '@/lib/lorebook/override-identity'

interface Props {
  chatId: string
  characterId: string
}

export default async function LorebookPanelLoader({ chatId, characterId }: Props) {
  const supabase = await createClient()

  const [{ data: characterModules }, { data: lorebookOverridesV2 }, { data: lorebookOverridesV1 }] =
    await Promise.all([
      supabase
        .from('character_modules')
        .select(
          `
        module_id,
        enabled,
        modules (
          id,
          lorebook
        )
      `,
        )
        .eq('character_id', characterId)
        .eq('enabled', true),
      supabase
        .from('lorebook_overrides_v2')
        .select('module_id, entry_key, entry_insertorder, entry_fingerprint, enabled')
        .eq('chat_id', chatId),
      supabase
        .from('lorebook_overrides')
        .select('entry_key, entry_insertorder, enabled')
        .eq('chat_id', chatId),
    ])

  type LorebookEntryWithSource = LorebookEntry & { moduleId: string }
  const lorebookEntries: LorebookEntryWithSource[] = []
  if (characterModules) {
    for (const cm of characterModules) {
      const moduleData = Array.isArray(cm.modules) ? cm.modules[0] : cm.modules
      const moduleLorebook = (moduleData as { lorebook?: LorebookEntry[] } | null)?.lorebook
      if (moduleLorebook && Array.isArray(moduleLorebook)) {
        lorebookEntries.push(
          ...moduleLorebook.map((entry) => ({ ...entry, moduleId: cm.module_id })),
        )
      }
    }
  }

  if (lorebookEntries.length === 0) {
    return null
  }

  const overrideMap = new Map<string, boolean>()

  if (lorebookOverridesV2) {
    for (const override of lorebookOverridesV2) {
      if (!override.module_id || !override.entry_fingerprint) continue
      const key = getLorebookOverrideKeyV2(override.module_id, override.entry_fingerprint)
      overrideMap.set(key, override.enabled)
    }
  }

  // Best-effort legacy support:
  // - Only apply v1 overrides when the (entry_key, insertorder) pair is unique across loaded entries.
  if (lorebookOverridesV1 && lorebookOverridesV1.length > 0) {
    const legacyCounts = new Map<string, number>()
    for (const entry of lorebookEntries) {
      const legacyKey = `${entry.key}-${entry.insertorder}`
      legacyCounts.set(legacyKey, (legacyCounts.get(legacyKey) ?? 0) + 1)
    }

    for (const override of lorebookOverridesV1) {
      const legacyKey = `${override.entry_key}-${override.entry_insertorder}`
      if ((legacyCounts.get(legacyKey) ?? 0) !== 1) continue

      const matched = lorebookEntries.find(
        (e) => e.key === override.entry_key && e.insertorder === override.entry_insertorder,
      )
      if (!matched) continue

      const fingerprint = computeLorebookEntryFingerprint(matched.moduleId, matched)
      const key = getLorebookOverrideKeyV2(matched.moduleId, fingerprint)
      if (!overrideMap.has(key)) {
        overrideMap.set(key, override.enabled)
      }
    }
  }

  return (
    <LorebookPanel lorebookEntries={lorebookEntries} chatId={chatId} overrideMap={overrideMap} />
  )
}
