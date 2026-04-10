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
})
