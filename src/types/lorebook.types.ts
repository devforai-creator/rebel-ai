/**
 * Lorebook types retained for lorebook rendering and a small amount of
 * plain-text system-prompt context assembly. The former preset/module
 * template runtime has been retired from the active product surface.
 */

export interface LorebookEntry {
  key: string
  content: string
  comment?: string
  mode?: 'normal' | 'constant' | 'child' | 'folder' | string
  insertorder?: number
  alwaysActive?: boolean
  selective?: boolean
  secondkey?: string
  useRegex?: boolean
  folder?: string
  bookVersion?: number
  constant?: boolean
  negativePrimaryKeys?: string
  negativeSecondaryKeys?: string
  fullWordMatching?: boolean
  probability?: number
  activationMsg?: number
  scanDepth?: number
  placement?: string
  position?: number
  depth?: number
  role?: 'system' | 'user' | 'assistant'
  parentId?: string
  chatId?: string
  injectLore?: string
  keepActivateAfterMatch?: boolean
  dontActivateAfterMatch?: boolean
  [key: string]: unknown
}

export interface EvaluationContext {
  globalVars: Record<string, unknown>
  tempVars?: Record<string, unknown>
  char?: string
  user?: string
  chatId?: string
  messageHistory?: Array<{ role: string; content: string }>
  assetUrlMap?: Record<string, string>
  randomSeed?: string
  [key: string]: unknown
}
