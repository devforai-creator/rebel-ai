/**
 * Global System Prompt Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BASE_GLOBAL_SYSTEM_PROMPT } from './global-system-prompt'

describe('global-system-prompt', () => {
  describe('BASE_GLOBAL_SYSTEM_PROMPT', () => {
    it('contains interactive narrative system header', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('# Interactive Narrative System')
    })

    it('contains core directive about controlling NPCs', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain(
        "You control EVERYTHING in the narrative except the user's character",
      )
    })

    it('contains critical constraint about not controlling user character', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('ABSOLUTE RULE')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain(
        "NEVER write, describe, or assume anything about the user's character",
      )
    })

    it('contains forbidden actions list', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('FORBIDDEN')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain("Writing the user character's dialogue")
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain("Describing the user character's actions")
    })

    it('contains response structure guidance', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Environmental Description')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('NPC Dialogue')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('NPC Actions')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Character Images')
    })

    it('contains style guidelines for pacing', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Short user input')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Detailed user input')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Action scenes')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Emotional moments')
    })
  })

  describe('getGlobalSystemPrompt', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('returns base prompt in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      const { getGlobalSystemPrompt } = await import('./global-system-prompt')
      const prompt = getGlobalSystemPrompt()

      expect(prompt).toBe(BASE_GLOBAL_SYSTEM_PROMPT)
      expect(prompt).not.toContain('[LOCAL_DEV_ENV]')
    })

    it('prepends [LOCAL_DEV_ENV] in development', async () => {
      vi.stubEnv('NODE_ENV', 'development')

      const { getGlobalSystemPrompt } = await import('./global-system-prompt')
      const prompt = getGlobalSystemPrompt()

      expect(prompt).toContain('[LOCAL_DEV_ENV]')
      expect(prompt.startsWith('[LOCAL_DEV_ENV]\n\n')).toBe(true)
      expect(prompt).toContain(BASE_GLOBAL_SYSTEM_PROMPT)
    })

    it('prepends [LOCAL_DEV_ENV] in test environment', async () => {
      vi.stubEnv('NODE_ENV', 'test')

      const { getGlobalSystemPrompt } = await import('./global-system-prompt')
      const prompt = getGlobalSystemPrompt()

      expect(prompt).toContain('[LOCAL_DEV_ENV]')
    })

    it('prompt content is not empty', async () => {
      const { getGlobalSystemPrompt } = await import('./global-system-prompt')
      const prompt = getGlobalSystemPrompt()

      expect(prompt.length).toBeGreaterThan(100)
    })
  })
})
