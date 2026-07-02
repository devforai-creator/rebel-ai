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

    it('contains critical constraint about preserving user character sovereignty', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Critical Constraint: Sovereign User Character')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain(
        "Never decide the user's voluntary actions, dialogue, thoughts, feelings, choices, consent, or reactions",
      )
    })

    it('contains forbidden actions list', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('FORBIDDEN')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain("Writing the user character's dialogue")
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain(
        'Describing voluntary actions the user did not state',
      )
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain(
        'Forcing the user character to follow, touch, accept, confess, fight, flee, or participate',
      )
    })

    it('contains narrative initiative guidance', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Narrative Initiative and Story Momentum')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Active World, Sovereign User')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Bounded Initiative')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Scene Momentum Rule')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Natural Social and Romantic Progression')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain(
        "NPCs may initiate social or romantic developments, but the user's acceptance, rejection, desire, and response belong entirely to the user",
      )
    })

    it('contains response structure guidance', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Environmental Description')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('NPC Dialogue')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('NPC Actions')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Character Images')
    })

    it('contains explicit character image token guidance', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('insert actual character image tokens frequently')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain("Actually output the character's image command")
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain(
        'prefer including an image command every few assistant responses',
      )
    })

    it('contains style guidelines for pacing', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain(
        'User input length is a signal, not a strict limit',
      )
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain(
        'Brief input during an emotional, romantic, tense, or uncertain moment',
      )
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Detailed input')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Action scenes')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Emotional scenes')
    })

    it('contains response length contract guidance', () => {
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('Response Length Contract')
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain(
        'do not answer in only one or two terse paragraphs',
      )
      expect(BASE_GLOBAL_SYSTEM_PROMPT).toContain('treat it as an emotional or pacing signal')
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
