/**
 * Lorebook Renderer
 * Activates and renders lorebook entries based on chat context
 */

import type { LorebookEntry } from '@/types/lorebook.types'

export interface RenderLorebookOptions {
  lorebookEntries: LorebookEntry[]
  chatHistory: Array<{ role: string; content: string }>
  maxTokens?: number // Optional token limit (rough estimate by chars)
}

export interface RenderedLorebook {
  activeEntries: LorebookEntry[]
  text: string
  stats: {
    total: number
    active: number
    alwaysActive: number
    keywordActivated: number
    folders: number
  }
}

/**
 * Render active lorebook entries based on activation rules
 *
 * Activation Rules:
 * 1. Folders (mode: "folder") are NEVER rendered
 * 2. Always active entries (alwaysActive: true) are ALWAYS included
 * 3. Keyword entries are included if ANY keyword matches chat history
 * 4. Entries are sorted by insertorder (higher = earlier in prompt)
 */
export function renderLorebook(options: RenderLorebookOptions): RenderedLorebook {
  const { lorebookEntries, chatHistory, maxTokens } = options

  // Statistics
  const stats = {
    total: lorebookEntries.length,
    active: 0,
    alwaysActive: 0,
    keywordActivated: 0,
    folders: 0,
  }

  // 1. Filter out folders (they're for organization only)
  const validEntries = lorebookEntries.filter((entry) => {
    if (entry.mode === 'folder') {
      stats.folders++
      return false
    }
    return true
  })

  // Build chat history text for keyword matching (case-insensitive)
  const historyText = chatHistory
    .map((msg) => msg.content)
    .join(' ')
    .toLowerCase()

  // 2. Filter active entries
  const activeEntries = validEntries.filter((entry) => {
    // Always active entries
    if (entry.alwaysActive) {
      stats.alwaysActive++
      return true
    }

    // Keyword-based activation
    if (entry.key) {
      const keywords = entry.key
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)

      // Check if ANY keyword matches
      const matchedKeywords = keywords.filter((keyword) => historyText.includes(keyword))
      const hasMatch = matchedKeywords.length > 0

      if (hasMatch) {
        stats.keywordActivated++
        return true
      }
    }

    return false
  })

  // 3. Sort by insertorder (higher = earlier in prompt, more important)
  activeEntries.sort((a, b) => (b.insertorder ?? 0) - (a.insertorder ?? 0))

  // 4. Build text (with optional token limit)
  let text = ''
  let includedEntries = activeEntries

  if (maxTokens) {
    // Rough token estimate: 1 token ≈ 4 characters
    const maxChars = maxTokens * 4
    let currentChars = 0
    includedEntries = []

    for (const entry of activeEntries) {
      const entryLength = entry.content.length + 4 // +4 for "\n\n"
      if (currentChars + entryLength > maxChars) {
        continue
      }
      includedEntries.push(entry)
      currentChars += entryLength
    }
  }

  text = includedEntries.map((entry) => entry.content).join('\n\n')

  stats.active = includedEntries.length

  return {
    activeEntries: includedEntries,
    text,
    stats,
  }
}

/**
 * Get lorebook entries by folder
 * Useful for UI rendering
 */
export function groupLorebookByFolder<T extends LorebookEntry>(entries: T[]): Map<string, T[]> {
  const folderMap = new Map<string, T[]>()

  // Find all folder entries first
  const folders = entries.filter((e) => e.mode === 'folder')
  const normalEntries = entries.filter((e) => e.mode !== 'folder')

  // Initialize folder groups
  for (const folder of folders) {
    folderMap.set(folder.key, [])
  }

  // Add "root" for entries without folder
  folderMap.set('__root__', [])

  // Group normal entries by folder
  for (const entry of normalEntries) {
    if (entry.folder && folderMap.has(entry.folder)) {
      folderMap.get(entry.folder)!.push(entry)
    } else {
      folderMap.get('__root__')!.push(entry)
    }
  }

  return folderMap
}

/**
 * Get folder metadata
 */
export function getFolderMetadata(entries: LorebookEntry[]) {
  return entries
    .filter((e) => e.mode === 'folder')
    .map((folder) => ({
      id: folder.key,
      name: folder.comment ?? folder.key,
      insertorder: folder.insertorder ?? 0,
    }))
}
