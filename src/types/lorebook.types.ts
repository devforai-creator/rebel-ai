/**
 * Lorebook types retained for lorebook rendering and a small amount of
 * plain-text system-prompt context assembly. The former preset/module
 * template runtime has been retired from the active product surface.
 *
 * Runtime support is intentionally narrow. The active renderer evaluates
 * alwaysActive, key, content, mode, and insertorder, with an optional rough
 * maxTokens cap. Additional fields are retained for import compatibility,
 * override identity, and UI display, but they are not activation semantics
 * unless a renderer explicitly consumes them.
 */

export interface LorebookEntry {
  key: string
  content: string
  comment?: string
  mode?: 'normal' | 'constant' | 'child' | 'folder' | string
  insertorder?: number
  alwaysActive?: boolean
  /** Import/override compatibility only; the active renderer does not evaluate secondary keys. */
  selective?: boolean
  /** Import/override compatibility only; the active renderer does not evaluate secondary keys. */
  secondkey?: string
  /** Import/override compatibility only; the active renderer treats key as plain text. */
  useRegex?: boolean
  folder?: string
  bookVersion?: number
  constant?: boolean
  /** Import compatibility only; negative activation keys are not evaluated by the active renderer. */
  negativePrimaryKeys?: string
  /** Import compatibility only; negative activation keys are not evaluated by the active renderer. */
  negativeSecondaryKeys?: string
  /** Import compatibility only; active keyword matching uses plain substring includes. */
  fullWordMatching?: boolean
  /** Import compatibility only; probabilistic activation is not evaluated by the active renderer. */
  probability?: number
  activationMsg?: number
  /** Import compatibility only; the active renderer scans the provided chat history as a whole. */
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
