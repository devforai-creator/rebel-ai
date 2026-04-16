import { describe, expect, it } from 'vitest'
import { resolveChatMetadataViews } from './useChatMetadataViews'

describe('resolveChatMetadataViews', () => {
  it('merges default and runtime variables while keeping valid ui cards', () => {
    const result = resolveChatMetadataViews({
      characterMetadata: {
        default_variables: {
          mood: 'calm',
          accent: 'soft',
        },
        ui_card: {
          meta: { version: '1.0' },
          views: { compact: { title: 'primary' } },
        },
        ui_cards: {
          primary: {
            meta: { version: '1.0' },
            views: { full: { title: 'primary' } },
          },
          invalid: {
            meta: { version: '1.0' },
            views: {},
          },
          '': {
            meta: { version: '1.0' },
            views: { compact: { title: 'blank key' } },
          },
        },
        image_display: {
          meta: { version: '1.0' },
          views: { hero: { mode: 'cover' } },
        },
      },
      runtimeVariables: {
        mood: 'energetic',
        locale: 'ko',
      },
    })

    expect(result.defaultVariables).toEqual({
      mood: 'calm',
      accent: 'soft',
    })
    expect(result.mergedVariables).toEqual({
      mood: 'energetic',
      accent: 'soft',
      locale: 'ko',
    })
    expect(result.uiCard).toEqual({
      meta: { version: '1.0' },
      views: { compact: { title: 'primary' } },
    })
    expect(result.uiCardRegistry).toEqual({
      primary: {
        meta: { version: '1.0' },
        views: { full: { title: 'primary' } },
      },
    })
    expect(result.imageDisplay).toEqual({
      meta: { version: '1.0' },
      views: { hero: { mode: 'cover' } },
    })
  })

  it('drops invalid metadata views and still returns runtime variables', () => {
    const result = resolveChatMetadataViews({
      characterMetadata: {
        ui_card: {
          meta: { version: '1.0' },
          views: {},
        },
        ui_cards: ['invalid'],
        image_display: {
          meta: { version: '1.0' },
          views: {},
        },
      },
      runtimeVariables: {
        locale: 'en',
      },
    })

    expect(result.defaultVariables).toBeUndefined()
    expect(result.mergedVariables).toEqual({ locale: 'en' })
    expect(result.uiCard).toBeNull()
    expect(result.uiCardRegistry).toBeNull()
    expect(result.imageDisplay).toBeNull()
  })
})
