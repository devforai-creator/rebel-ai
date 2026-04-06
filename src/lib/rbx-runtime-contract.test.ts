import { describe, expect, it } from 'vitest'

import type { RbxManifest } from '@/types/rbx.types'
import { assertRbxRuntimeContract, getRbxRuntimeContractViolations } from './rbx-runtime-contract'

function createManifest(overrides?: Partial<RbxManifest>): RbxManifest {
  return {
    format: 'rbx',
    version: '1.1',
    character: {
      name: 'Test Character',
      description: null,
      system_prompt: 'You are a test character.',
      greeting_message: 'Hello there.',
      visibility: 'private',
      metadata: {
        type: 'character',
        post_history_instructions: null,
        alternate_greetings: [],
        ui_card: null,
        ui_cards: {},
        background_html: null,
        default_variables: {},
        character_list: [],
        image_commands: {},
        image_display: null,
      },
    },
    assets: [],
    modules: [],
    ...overrides,
  }
}

describe('rbx runtime contract', () => {
  it('accepts a minimal manifest that stays inside the contract', () => {
    const manifest = createManifest()

    expect(() => assertRbxRuntimeContract(manifest)).not.toThrow()
    expect(getRbxRuntimeContractViolations(manifest)).toEqual([])
  })

  it('rejects background_html and template-bearing prompt fields', () => {
    const manifest = createManifest({
      character: {
        name: 'Legacy Character',
        description: null,
        system_prompt: 'You are {{char}}.',
        greeting_message: 'Hello {{user}}',
        visibility: 'private',
        metadata: {
          type: 'character',
          post_history_instructions: '{{#if foo}}legacy{{/if}}',
          alternate_greetings: ['Hi', 'Welcome {{user}}'],
          ui_card: null,
          ui_cards: {},
          background_html: '<div>legacy</div>',
          default_variables: {},
          character_list: [],
          image_commands: {},
          image_display: null,
        },
      },
    })

    const violations = getRbxRuntimeContractViolations(manifest)

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('background_html'),
        expect.stringContaining('character.system_prompt'),
        expect.stringContaining('character.greeting_message'),
        expect.stringContaining('post_history_instructions'),
        expect.stringContaining('alternate_greetings[1]'),
      ]),
    )
    expect(() => assertRbxRuntimeContract(manifest)).toThrow(
      'RBX import rejected by runtime contract',
    )
  })

  it('rejects legacy module triggers, toggle_definitions, editdisplay, and templated lorebook', () => {
    const manifest = createManifest({
      modules: [
        {
          enabled: true,
          priority: 0,
          module: {
            name: 'Legacy Module',
            description: null,
            lorebook: [{ key: 'hp', content: 'HP is {{getvar::hp}}' }],
            regex: [{ in: 'x', out: 'y', type: 'editdisplay' }],
            hide_icon: false,
            assets: [],
            triggers: [{ type: 'manual', comment: 'legacy', effect: [] }],
            toggle_definitions: { wideView: { label: 'Wide', type: 'boolean', default: '0' } },
          } as never,
        },
      ],
    })

    const violations = getRbxRuntimeContractViolations(manifest)

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('.triggers'),
        expect.stringContaining('.toggle_definitions'),
        expect.stringContaining('editdisplay'),
        expect.stringContaining('.lorebook[0].content'),
      ]),
    )
  })
})
