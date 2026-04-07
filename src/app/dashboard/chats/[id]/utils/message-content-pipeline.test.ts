import { describe, expect, it } from 'vitest'

import {
  computeClientRenderDiagnostics,
  normalizeFullwidthChars,
  prepareMessageContentForRendering,
} from './message-content-pipeline'

describe('computeClientRenderDiagnostics', () => {
  it('returns null embeddedHtmlDoc for plain text', () => {
    const result = computeClientRenderDiagnostics('hello', undefined, undefined, 360)

    expect(result.screenWidth).toBe(360)
    expect(result.embeddedHtmlDoc).toBeNull()
  })

  it('no longer surfaces HTML document diagnostics after raw HTML removal', () => {
    const htmlDoc =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><div>ok</div></body></html>'

    const result = computeClientRenderDiagnostics(htmlDoc, undefined, undefined, 390)

    expect(result.embeddedHtmlDoc).toBeNull()
  })

  it('treats asset HTML documents as plain content in diagnostics', () => {
    const htmlDoc = [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="asset">',
      '</head>',
      '<body><img src="x"></body>',
      '</html>',
    ].join('')

    const result = computeClientRenderDiagnostics(htmlDoc, undefined, undefined)

    expect(result.embeddedHtmlDoc).toBeNull()
  })

  it('captures the current normalization pipeline while ignoring legacy module regex config', () => {
    const content = '<img="Charlotte.standing">'
    const moduleRegex = [
      {
        type: 'editdisplay',
        comment: 'swap extension',
        in: '<img="(.*?)">',
        out: '<img src="$1.webp">',
        ableFlag: true,
      },
    ]
    const assetUrlMap = {
      'Charlotte.standing.png': 'https://example.com/charlotte.png',
    }

    const result = computeClientRenderDiagnostics(content, moduleRegex, assetUrlMap, 800)

    expect(result.pipelineTrace.map((step) => step.name)).toEqual([
      'original',
      'after_asset_token_normalization',
      'after_fullwidth_normalization',
      'after_move_top',
    ])
    expect(result.pipelineTrace[1]?.changed).toBe(true)
    expect(result.unresolvedImageTags).toEqual([])
    expect(result.unresolvedImageTagsRaw).toEqual([])
  })

  it('treats prefix-resolved character assets as resolved in strict mode', () => {
    const content = '<img="Yoona_thinking">'
    const assetUrlMap = {}
    const characterAssets = [
      {
        id: 'asset-1',
        file_name: 'Yoona_thinking.1.avif',
        storage_path: 'assets/Yoona_thinking.1.avif',
        display_name: null,
        metadata: null,
      },
    ]

    const result = computeClientRenderDiagnostics(
      content,
      undefined,
      assetUrlMap,
      400,
      undefined,
      undefined,
      undefined,
      undefined,
      characterAssets,
    )

    expect(result.unresolvedImageTags).toEqual([])
    expect(result.unresolvedImageTagsRaw).toEqual([
      {
        original: '![Yoona_thinking](asset:Yoona_thinking)',
        extractedName: 'Yoona_thinking',
      },
    ])
  })

  it('treats dot-style asset tags as resolved via underscore image command keys', () => {
    const result = computeClientRenderDiagnostics(
      '![Ako](asset:Ako.surprised)',
      undefined,
      {},
      400,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { ako_surprised: 'https://example.com/ako-surprised.png' },
    )

    expect(result.unresolvedImageTags).toEqual([])
    expect(result.unresolvedImageTagsRaw).toEqual([
      {
        original: '![Ako](asset:Ako.surprised)',
        extractedName: 'Ako.surprised',
      },
    ])
  })
})

describe('normalizeFullwidthChars', () => {
  it('converts fullwidth pipe to ASCII', () => {
    const input = '날짜｜시간｜장소'
    const result = normalizeFullwidthChars(input)
    expect(result).toBe('날짜|시간|장소')
  })

  it('converts fullwidth brackets to ASCII', () => {
    const input = '［2025-05-12］'
    const result = normalizeFullwidthChars(input)
    expect(result).toBe('[2025-05-12]')
  })

  it('converts fullwidth colon to ASCII', () => {
    const input = 'Rationality：-5'
    const result = normalizeFullwidthChars(input)
    expect(result).toBe('Rationality:-5')
  })

  it('converts various dash types to ASCII hyphen', () => {
    const input = '값－1 값–2 값—3'
    const result = normalizeFullwidthChars(input)
    expect(result).toBe('값-1 값-2 값-3')
  })

  it('converts mixed fullwidth characters', () => {
    const input = '［2025-05-12｜14：05｜장소］'
    const result = normalizeFullwidthChars(input)
    expect(result).toBe('[2025-05-12|14:05|장소]')
  })

  it('returns original text when no fullwidth chars present (fast path)', () => {
    const input = '[2025-05-12|14:05|Location]'
    const result = normalizeFullwidthChars(input)
    expect(result).toBe(input)
  })

  it('handles empty string', () => {
    expect(normalizeFullwidthChars('')).toBe('')
  })
})

describe('prepareMessageContentForRendering', () => {
  it('normalizes legacy image tags to canonical asset markdown', () => {
    const content = 'Hello\n\n<mmg="Haerin_handjob hard">\n\nWorld'
    const { processedContent } = prepareMessageContentForRendering(content)
    expect(processedContent).toContain('![Haerin_handjob hard](asset:Haerin_handjob hard)')
    expect(processedContent).not.toContain('<mmg')
  })

  it('preserves canonical asset markdown tokens', () => {
    const content = 'Mood check ![worried](asset:Yoona_thinking)'
    const { processedContent } = prepareMessageContentForRendering(content)

    expect(processedContent).toContain('![worried](asset:Yoona_thinking)')
  })

  it('still supports @@move_top after legacy runtime removal', () => {
    const content = ['body', '@@move_top header', 'tail'].join('\n')
    const { processedContent } = prepareMessageContentForRendering(content)

    expect(processedContent).toBe('header\ntail\nbody')
  })

  it('leaves legacy template syntax untouched after runtime removal', () => {
    const content = 'Width {{screen_width}} / mood {{getvar::mood}}'
    const { processedContent } = prepareMessageContentForRendering(content)

    expect(processedContent).toBe(content)
  })
})
