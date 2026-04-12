import { describe, expect, it } from 'vitest'
import { formatSuuImportValidationIssue, validateSuuImportMetadata } from './suu-import-validation'

describe('validateSuuImportMetadata', () => {
  it('accepts valid SUU cards without warnings', () => {
    const result = validateSuuImportMetadata({
      ui_card: {
        meta: { name: 'status', version: '1.0.0' },
        views: {
          Main: {
            type: 'Text',
            content: 'Hello',
          },
        },
      },
      ui_cards: {},
      image_display: null,
    })

    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('classifies unsupported card structure as a warning', () => {
    const result = validateSuuImportMetadata({
      ui_card: {
        meta: { name: 'legacy', version: '1.0.0' },
        views: {
          Main: {
            type: 'UnknownThing',
          },
        },
      },
      ui_cards: {},
      image_display: null,
    })

    expect(result.errors).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe('SCHEMA_ERROR')
    expect(formatSuuImportValidationIssue(result.warnings[0])).toContain(
      'character.metadata.ui_card.views.Main',
    )
  })

  it('rejects unsafe external asset URLs', () => {
    const result = validateSuuImportMetadata({
      ui_card: {
        meta: { name: 'remote-image', version: '1.0.0' },
        views: {
          Main: {
            type: 'Image',
            src: 'https://evil.test/x.png',
            alt: 'Remote image',
          },
        },
      },
      ui_cards: {},
      image_display: null,
    })

    expect(result.warnings).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].code).toBe('EXTERNAL_URL')
    expect(formatSuuImportValidationIssue(result.errors[0])).toContain(
      'character.metadata.ui_card.views.Main.src',
    )
  })

  it('rejects data URLs in imported SUU cards', () => {
    const result = validateSuuImportMetadata({
      ui_card: {
        meta: { name: 'embedded-image', version: '1.0.0' },
        views: {
          Main: {
            type: 'Image',
            src: 'data:image/png;base64,abc123',
          },
        },
      },
      ui_cards: {},
      image_display: null,
    })

    expect(result.warnings).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].code).toBe('EXTERNAL_URL')
  })

  it('rejects non-asset src values across image_display and named ui cards', () => {
    const result = validateSuuImportMetadata({
      ui_card: null,
      ui_cards: {
        Gallery: {
          meta: { name: 'gallery', version: '1.0.0' },
          views: {
            Main: {
              type: 'Image',
              src: 'images/local.png',
            },
          },
        },
      },
      image_display: {
        meta: { name: 'display', version: '1.0.0' },
        views: {
          Main: {
            type: 'Image',
            src: '/tmp/image.png',
          },
        },
      },
    })

    expect(result.warnings).toEqual([])
    expect(result.errors.map((issue) => issue.code)).toEqual([
      'INVALID_ASSET_PATH',
      'INVALID_ASSET_PATH',
    ])
    expect(formatSuuImportValidationIssue(result.errors[0])).toContain(
      'character.metadata.image_display.views.Main.src',
    )
    expect(formatSuuImportValidationIssue(result.errors[1])).toContain(
      'character.metadata.ui_cards.Gallery.views.Main.src',
    )
  })

  it('rejects prototype-polluting keys and css url() in style contexts', () => {
    const payload: Record<string, unknown> = {
      meta: { name: 'unsafe-style', version: '1.0.0' },
      views: {
        Main: {
          type: 'Text',
          content: 'Hello',
          style: {
            backgroundImage: 'url(https://evil.test/x.png)',
          },
        },
      },
    }
    Object.defineProperty(payload, '__proto__', {
      value: { polluted: true },
      enumerable: true,
    })

    const result = validateSuuImportMetadata({
      ui_card: payload,
      ui_cards: {},
      image_display: null,
    })

    expect(result.warnings).toEqual([])
    expect(result.errors).toHaveLength(2)
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['PROTOTYPE_POLLUTION', 'FORBIDDEN_CSS_FUNCTION']),
    )
    expect(
      formatSuuImportValidationIssue(
        result.errors.find((issue) => issue.code === 'PROTOTYPE_POLLUTION')!,
      ),
    ).toContain('character.metadata.ui_card.__proto__')
    expect(
      formatSuuImportValidationIssue(
        result.errors.find((issue) => issue.code === 'FORBIDDEN_CSS_FUNCTION')!,
      ),
    ).toContain('character.metadata.ui_card.views.Main.style.backgroundImage')
  })

  it('surfaces serialization failures for circular SUU payloads', () => {
    const circularCard: Record<string, unknown> = {
      meta: { name: 'circular', version: '1.0.0' },
      views: {
        Main: {
          type: 'Text',
          content: 'Hello',
        },
      },
    }
    circularCard.self = circularCard

    const result = validateSuuImportMetadata({
      ui_card: circularCard,
      ui_cards: {},
      image_display: null,
    })

    expect(result.warnings).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].code).toBe('INVALID_JSON')
    expect(formatSuuImportValidationIssue(result.errors[0])).toContain(
      'Failed to serialize SUU payload',
    )
  })
})
