import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// Mock UGCRenderer before importing message-renderer
vi.mock('@safe-ugc-ui/react', () => ({
  UGCRenderer: (props: {
    card: string
    state: Record<string, unknown>
    assets?: Record<string, string>
  }) => {
    return React.createElement('div', {
      'data-testid': 'ugc-renderer',
      'data-state': JSON.stringify(props.state),
      'data-card': props.card,
      'data-assets': props.assets ? JSON.stringify(props.assets) : undefined,
    })
  },
}))

import { renderMessageContent } from './message-renderer'

describe('renderMessageContent', () => {
  it('renders HTML wrappers as text while still resolving inline emotion images', () => {
    const content = '<div class="image-stat"><span>header</span><img="Geum Ji-su"></div>'
    const node = renderMessageContent(content, [], undefined, {
      'Geum Ji-su': 'https://example.com/ji-su.png',
    })

    const html = renderToStaticMarkup(<>{node}</>)

    expect(html).not.toContain('class="image-stat"')
    expect(html).toContain('&lt;div class=&quot;image-stat&quot;&gt;')
    expect(html).toContain('header')
    expect(html).toContain('alt="Geum Ji-su"')
  })

  it('renders raw HTML tags as text instead of preserving DOM attributes', () => {
    const content = '<div class="param-category" data-tooltip="포만감 수치입니다">포만감: 68</div>'
    const node = renderMessageContent(content, [])

    const html = renderToStaticMarkup(<>{node}</>)

    expect(html).toContain('&lt;div class=&quot;param-category&quot;')
    expect(html).toContain('포만감: 68')
  })

  it('does not synthesize legacy asset tables around image tags', () => {
    const content = '<img="Geum Ji-su">'
    const node = renderMessageContent(
      content, // content
      [], // characterAssets
      undefined, // assetUrlMap
      { 'Geum Ji-su': 'https://example.com/ji-su.png' }, // imageCommandUrlMap
      undefined, // moduleRegex
      undefined, // screenWidth
      undefined, // defaultVariables
      undefined, // characterName
      undefined, // randomSeed
      '<style>.image-cell img{}</style>', // extraHeadHtml (ignored for plain image rendering)
    )

    const html = renderToStaticMarkup(<>{node}</>)

    expect(html).not.toContain('class="asset-table"')
    expect(html).not.toContain('class="image-cell')
    expect(html).toContain('alt="Geum Ji-su"')
    expect(html).toContain('src="https://example.com/ji-su.png"')
    expect(html).not.toContain('/_next/image')
  })

  describe('emotion tag formats', () => {
    const imageCommandUrlMap = {
      happy: 'https://example.com/happy.png',
      sad: 'https://example.com/sad.png',
      'test image': 'https://example.com/test.png',
    }

    it('resolves canonical ![alt](asset:key) format', () => {
      const content = '![hero is happy](asset:happy)'
      const node = renderMessageContent(content, [], undefined, imageCommandUrlMap)
      const html = renderToStaticMarkup(<>{node}</>)
      expect(html).toContain('alt="hero is happy"')
    })

    it('resolves dot-style asset tags through underscore image command keys', () => {
      const content = '![Ako](asset:Ako.surprised)'
      const node = renderMessageContent(content, [], undefined, {
        ako_surprised: 'https://example.com/ako-surprised.png',
      })
      const html = renderToStaticMarkup(<>{node}</>)
      expect(html).toContain('alt="Ako"')
      expect(html).toContain('ako-surprised.png')
    })

    it('resolves <img src="name"> format (double quotes)', () => {
      const content = '<img src="happy">'
      const node = renderMessageContent(content, [], undefined, imageCommandUrlMap)
      const html = renderToStaticMarkup(<>{node}</>)
      // Check alt attribute for stable signal (avoids Next.js Image URL encoding dependency)
      expect(html).toContain('alt="happy"')
      expect(html).toContain('img')
    })

    it("resolves <img src='name'> format (single quotes)", () => {
      const content = "<img src='happy'>"
      const node = renderMessageContent(content, [], undefined, imageCommandUrlMap)
      const html = renderToStaticMarkup(<>{node}</>)
      expect(html).toContain('alt="happy"')
    })

    it('resolves <img src=name> format (no quotes)', () => {
      const content = '<img src=happy>'
      const node = renderMessageContent(content, [], undefined, imageCommandUrlMap)
      const html = renderToStaticMarkup(<>{node}</>)
      expect(html).toContain('alt="happy"')
    })

    it('resolves [ 🖼 | name ] format (RisuRealm)', () => {
      const content = '[ 🖼 | happy ]'
      const node = renderMessageContent(content, [], undefined, imageCommandUrlMap)
      const html = renderToStaticMarkup(<>{node}</>)
      expect(html).toContain('alt="happy"')
    })

    it('resolves {{image::name}} format', () => {
      const content = '{{image::happy}}'
      const node = renderMessageContent(content, [], undefined, imageCommandUrlMap)
      const html = renderToStaticMarkup(<>{node}</>)
      expect(html).toContain('alt="happy"')
    })

    it('does NOT match http:// URLs (already resolved)', () => {
      const content = '<img src="https://already.resolved/image.png">'
      const node = renderMessageContent(content, [], undefined, imageCommandUrlMap)
      const html = renderToStaticMarkup(<>{node}</>)
      expect(html).toContain('&lt;img src=&quot;https://already.resolved/image.png&quot;&gt;')
      expect(html).not.toContain('example.com')
    })

    it('does NOT match data: URLs', () => {
      const content = '<img src="data:image/png;base64,abc123">'
      const node = renderMessageContent(content, [], undefined, imageCommandUrlMap)
      const html = renderToStaticMarkup(<>{node}</>)
      expect(html).toContain('data:image/png;base64,abc123')
    })

    it('handles multiple emotion tags in one message', () => {
      const content = '<img="happy"> some text <img="sad">'
      const node = renderMessageContent(content, [], undefined, imageCommandUrlMap)
      const html = renderToStaticMarkup(<>{node}</>)
      // Check alt attributes for stable signal
      expect(html).toContain('alt="happy"')
      expect(html).toContain('alt="sad"')
      expect(html).toContain('some text')
    })

    it('drops unresolved emotion tags when mixed with resolved ones', () => {
      // When at least one emotion is resolved, unresolved ones are dropped
      const content = '<img="happy"> text <img="unknown_emotion">'
      const node = renderMessageContent(content, [], undefined, imageCommandUrlMap)
      const html = renderToStaticMarkup(<>{node}</>)
      // Known emotion is rendered
      expect(html).toContain('alt="happy"')
      // Unknown emotion tag is dropped (not in output)
      expect(html).not.toContain('unknown_emotion')
      // Surrounding text is preserved
      expect(html).toContain('text')
    })

    it('drops unresolved emotion tags silently, preserving surrounding text', () => {
      // Realistic RP scenario: text + unresolved emotion + more text
      const content = '릴리아가 부끄러워했다.\n\n<img="lillia_embarrassed">\n\n"고, 골반...?"'
      const node = renderMessageContent(content, [], undefined, imageCommandUrlMap)
      const html = renderToStaticMarkup(<>{node}</>)
      // Surrounding text is preserved
      expect(html).toContain('릴리아가 부끄러워했다')
      expect(html).toContain('골반')
      // Unresolved tag is silently dropped
      expect(html).not.toContain('lillia_embarrassed')
      expect(html).not.toContain('&lt;img')
    })

    it('returns content as-is when tag-only and no emotions resolved', () => {
      // Edge case: tag-only content with no resolution falls back to original string
      const content = '<img="unknown_emotion">'
      const node = renderMessageContent(content, [], undefined, imageCommandUrlMap)
      const html = renderToStaticMarkup(<>{node}</>)
      expect(html).toContain('![unknown_emotion](asset:unknown_emotion)')
    })

    it('does not resolve plain emotion tags through generic assetUrlMap fallback', () => {
      const content = '<img="legacy pose.png">'
      const node = renderMessageContent(
        content,
        [
          {
            id: 'asset-1',
            file_name: 'hero_happy.png',
            storage_path: 'char-1/hero_happy.png',
            metadata: null,
          },
        ],
        {
          'legacy pose.png': 'https://example.com/legacy-pose.png',
        },
      )
      const html = renderToStaticMarkup(<>{node}</>)

      expect(html).not.toContain('https://example.com/legacy-pose.png')
      expect(html).toContain('![legacy pose.png](asset:legacy pose.png)')
    })
  })

  describe('no assets or imageCommands', () => {
    it('renders plain HTML as escaped text when no assets are provided', () => {
      const content = '<div class="test"><strong>bold</strong></div>'
      const node = renderMessageContent(content, [])
      const html = renderToStaticMarkup(<>{node}</>)
      expect(html).toContain('&lt;div class=&quot;test&quot;&gt;')
      expect(html).toContain('&lt;strong&gt;bold&lt;/strong&gt;')
    })

    it('does not execute script tags and renders them as text', () => {
      const content = '<div>safe</div><script>alert("xss")</script>'
      const node = renderMessageContent(content, [])
      const html = renderToStaticMarkup(<>{node}</>)
      expect(html).toContain('safe')
      expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    })

    it('renders emphasis with markdown', () => {
      const node = renderMessageContent('*문을 닫고 숨을 고른다.*', [])
      const html = renderToStaticMarkup(<>{node}</>)

      expect(html).toContain('<em>문을 닫고 숨을 고른다.</em>')
    })

    it('treats single newlines as visible line breaks', () => {
      const node = renderMessageContent('첫째 줄\n둘째 줄', [])
      const html = renderToStaticMarkup(<>{node}</>)

      expect(html).toContain('첫째 줄<br/>')
      expect(html).toContain('둘째 줄')
    })

    it('renders blockquotes with markdown styling', () => {
      const node = renderMessageContent('> 속으로만 중얼거렸다', [])
      const html = renderToStaticMarkup(<>{node}</>)

      expect(html).toContain('<blockquote')
      expect(html).toContain('속으로만 중얼거렸다')
    })

    it('renders fenced code blocks', () => {
      const node = renderMessageContent('```ts\nconst mood = "calm"\n```', [])
      const html = renderToStaticMarkup(<>{node}</>)

      expect(html).toContain('<pre')
      expect(html).toContain('<code')
      expect(html).toContain('const mood =')
    })

    it('renders unsupported markdown images as literal text', () => {
      const node = renderMessageContent('![scene](https://example.com/scene.png)', [])
      const html = renderToStaticMarkup(<>{node}</>)

      expect(html).toContain('![scene](https://example.com/scene.png)')
      expect(html).not.toContain('<img')
    })
  })
})

// ============================================================================
// renderWithInlineUiCard (via renderMessageContent)
// ============================================================================

describe('renderMessageContent with inline ui_card', () => {
  const extractModuleRegex = [
    {
      type: 'extract' as const,
      comment: 'status',
      in: '\\[HP:(\\d+)/(\\d+)\\|Loc:([^\\]]+)\\]',
      out: '',
      ableFlag: true,
      bindings: { hp: '$1', maxHp: '$2', location: '$3' },
    },
  ]

  const uiCard = {
    meta: { name: 'test-panel', version: '1.0.0' },
    state: { hp: 100, maxHp: 100, location: 'Start' },
    views: { Main: { type: 'Column', children: [] } },
  }

  // Helper for calling renderMessageContent with ui_card params
  function renderWithUiCard(
    content: string,
    options?: {
      moduleRegex?: Parameters<typeof renderMessageContent>[4]
      uiCard?: Record<string, unknown> | null
      uiCardRegistry?: Record<string, Record<string, unknown>> | null
      defaultVariables?: Record<string, unknown>
    },
  ) {
    return renderMessageContent(
      content,
      [], // characterAssets
      undefined, // assetUrlMap
      undefined, // imageCommandUrlMap
      options?.moduleRegex ?? extractModuleRegex,
      undefined, // screenWidth
      options?.defaultVariables,
      undefined, // characterName
      undefined, // randomSeed
      undefined, // extraHeadHtml
      undefined, // scopeId
      'uiCard' in (options ?? {}) ? options!.uiCard : uiCard,
      options?.uiCardRegistry,
      undefined, // onUiCardAction
      true, // isLatestMessage
    )
  }

  it('renders UGCRenderer when extract regex matches', () => {
    const content = 'Dragon appears! [HP:87/100|Loc:Forest]'
    const node = renderWithUiCard(content)
    const html = renderToStaticMarkup(<>{node}</>)

    // UGCRenderer should be rendered (mocked as div with data-testid)
    expect(html).toContain('data-testid="ugc-renderer"')
    // Before-bracket text should be rendered
    expect(html).toContain('Dragon appears!')
  })

  it('extracts variables and merges with card state', () => {
    const content = 'Text [HP:87/100|Loc:Forest]'
    const node = renderWithUiCard(content)
    const html = renderToStaticMarkup(<>{node}</>)

    // Parse the state from the mocked UGCRenderer
    const stateMatch = html.match(/data-state="([^"]*)"/)
    expect(stateMatch).toBeTruthy()
    const state = JSON.parse(stateMatch![1].replace(/&quot;/g, '"'))

    // hp and maxHp should be numbers (type-preserved from card state)
    expect(state.hp).toBe(87)
    expect(state.maxHp).toBe(100)
    // location should be a string
    expect(state.location).toBe('Forest')
  })

  it('returns null (falls through) when no extract regex exists', () => {
    const nonExtractRegex = [
      { type: 'editoutput' as const, comment: '', in: 'foo', out: 'bar', ableFlag: true },
    ]
    const content = 'Some text [HP:87/100|Loc:Forest]'
    const node = renderWithUiCard(content, { moduleRegex: nonExtractRegex })
    const html = renderToStaticMarkup(<>{node}</>)

    // Should NOT render UGCRenderer — falls through to default pipeline
    expect(html).not.toContain('data-testid="ugc-renderer"')
    expect(html).toContain('Some text')
  })

  it('returns null when extract regex does not match content', () => {
    const content = 'No status bracket here, just text.'
    const node = renderWithUiCard(content)
    const html = renderToStaticMarkup(<>{node}</>)

    // No match → falls through
    expect(html).not.toContain('data-testid="ugc-renderer"')
    expect(html).toContain('just text')
  })

  it('returns null when uiCard is null', () => {
    const content = 'Text [HP:87/100|Loc:Forest]'
    const node = renderWithUiCard(content, { uiCard: null })
    const html = renderToStaticMarkup(<>{node}</>)

    expect(html).not.toContain('data-testid="ugc-renderer"')
  })

  it('renders after-bracket content', () => {
    const content = '[HP:50/100|Loc:Cave] The battle continues!'
    const node = renderWithUiCard(content)
    const html = renderToStaticMarkup(<>{node}</>)

    expect(html).toContain('data-testid="ugc-renderer"')
    expect(html).toContain('The battle continues!')
  })

  it('merges defaultVariables between card state and extracted values', () => {
    const content = 'Text [HP:60/100|Loc:Town]'
    const node = renderWithUiCard(content, {
      defaultVariables: { hp: 999, customVar: 'hello' },
    })
    const html = renderToStaticMarkup(<>{node}</>)

    const stateMatch = html.match(/data-state="([^"]*)"/)
    const state = JSON.parse(stateMatch![1].replace(/&quot;/g, '"'))

    // extracted hp=60 should override defaultVariables hp=999
    expect(state.hp).toBe(60)
    // defaultVariables customVar should be present
    expect(state.customVar).toBe('hello')
  })

  it('coerces extracted string to boolean based on card state type', () => {
    const boolUiCard = {
      meta: { name: 'bool-test', version: '1.0.0' },
      state: { hp: 100, maxHp: 100, location: 'Start', wideView: false },
      views: { Main: { type: 'Column', children: [] } },
    }
    const boolRegex = [
      {
        type: 'extract' as const,
        comment: '',
        in: '\\[HP:(\\d+)/(\\d+)\\|Loc:([^|\\]]+)\\|Wide:(\\d)\\]',
        out: '',
        ableFlag: true,
        bindings: { hp: '$1', maxHp: '$2', location: '$3', wideView: '$4' },
      },
    ]
    const content = 'Status [HP:50/100|Loc:Cave|Wide:1]'
    const node = renderWithUiCard(content, { uiCard: boolUiCard, moduleRegex: boolRegex })
    const html = renderToStaticMarkup(<>{node}</>)

    const stateMatch = html.match(/data-state="([^"]*)"/)
    const state = JSON.parse(stateMatch![1].replace(/&quot;/g, '"'))

    // "1" should be coerced to boolean true (card state has wideView: false)
    expect(state.wideView).toBe(true)
    expect(typeof state.wideView).toBe('boolean')
  })

  it('does not apply defaultVariables for past messages (isLatestMessage=false)', () => {
    const content = 'Old message [HP:40/100|Loc:Dungeon]'
    const node = renderMessageContent(
      content,
      [], // characterAssets
      undefined, // assetUrlMap
      undefined, // imageCommandUrlMap
      extractModuleRegex,
      undefined, // screenWidth
      { hp: 999, customVar: 'live-value' }, // defaultVariables
      undefined, // characterName
      undefined, // randomSeed
      undefined, // extraHeadHtml
      undefined, // scopeId
      uiCard,
      undefined, // uiCardRegistry
      undefined, // onUiCardAction
      false, // isLatestMessage = false → defaultVariables should NOT be applied
    )
    const html = renderToStaticMarkup(<>{node}</>)

    const stateMatch = html.match(/data-state="([^"]*)"/)
    const state = JSON.parse(stateMatch![1].replace(/&quot;/g, '"'))

    // extracted hp=40 applied (from extract regex)
    expect(state.hp).toBe(40)
    // defaultVariables should NOT be merged (past message snapshot)
    expect(state.customVar).toBeUndefined()
  })

  it('renders multiple inline cards in message order using card_ref', () => {
    const uiCardRegistry = {
      archive: {
        meta: { name: 'archive-card', version: '1.0.0' },
        state: { title: '', memo: '' },
        views: { Main: { type: 'Column', children: [] } },
      },
      invention: {
        meta: { name: 'invention-card', version: '1.0.0' },
        state: { name: '', note: '' },
        views: { Main: { type: 'Column', children: [] } },
      },
    }

    const multiRegex: NonNullable<Parameters<typeof renderMessageContent>[4]> = [
      {
        type: 'extract' as const,
        comment: 'invention',
        in: '\\[Invention:([^|\\]]+)\\|Note:([^\\]]+)\\]',
        out: '',
        ableFlag: true,
        bindings: { name: '$1', note: '$2' },
        card_ref: 'invention',
      },
      {
        type: 'extract' as const,
        comment: 'archive',
        in: '\\[Archive:([^|\\]]+)\\|Memo:([^\\]]+)\\]',
        out: '',
        ableFlag: true,
        bindings: { title: '$1', memo: '$2' },
        card_ref: 'archive',
      },
    ]

    const content = 'Intro [Archive:Alpha|Memo:First] middle [Invention:Beta|Note:Second] outro'
    const node = renderWithUiCard(content, {
      moduleRegex: multiRegex,
      uiCard: null,
      uiCardRegistry,
    })
    const html = renderToStaticMarkup(<>{node}</>)

    expect((html.match(/data-testid="ugc-renderer"/g) ?? []).length).toBe(2)
    expect(html).toContain('Intro')
    expect(html).toContain('middle')
    expect(html).toContain('outro')
    expect(html).not.toContain('[Archive:Alpha|Memo:First]')
    expect(html).not.toContain('[Invention:Beta|Note:Second]')
    expect(html.indexOf('archive-card')).toBeLessThan(html.indexOf('invention-card'))

    const stateMatches = [...html.matchAll(/data-state="([^"]*)"/g)].map((match) =>
      JSON.parse(match[1].replace(/&quot;/g, '"')),
    )
    expect(stateMatches).toHaveLength(2)
    expect(stateMatches[0]).toMatchObject({ title: 'Alpha', memo: 'First' })
    expect(stateMatches[0].name).toBeUndefined()
    expect(stateMatches[1]).toMatchObject({ name: 'Beta', note: 'Second' })
    expect(stateMatches[1].title).toBeUndefined()
  })

  it('uses the match-specific bindings for each repeated card instance', () => {
    const registry = {
      status: {
        meta: { name: 'status-card', version: '1.0.0' },
        state: { hp: 0 },
        views: { Main: { type: 'Column', children: [] } },
      },
    }

    const regex: NonNullable<Parameters<typeof renderMessageContent>[4]> = [
      {
        type: 'extract' as const,
        comment: 'hp',
        in: '\\[HP:(\\d+)\\]',
        out: '',
        ableFlag: true,
        bindings: { hp: '$1' },
        card_ref: 'status',
      },
    ]

    const node = renderWithUiCard('[HP:10] and then [HP:25]', {
      moduleRegex: regex,
      uiCard: null,
      uiCardRegistry: registry,
    })
    const html = renderToStaticMarkup(<>{node}</>)
    const stateMatches = [...html.matchAll(/data-state="([^"]*)"/g)].map((match) =>
      JSON.parse(match[1].replace(/&quot;/g, '"')),
    )

    expect(stateMatches).toHaveLength(2)
    expect(stateMatches[0].hp).toBe(10)
    expect(stateMatches[1].hp).toBe(25)
  })

  describe('image_display', () => {
    const validImageDisplay = {
      meta: { name: 'img-display', version: '1.0.0' },
      views: {
        Main: {
          type: 'Container',
          style: { height: '25em' },
          children: [{ type: 'Image', src: '@assets/emotion' }],
        },
      },
    }

    function renderWithImageDisplay(
      content: string,
      imageCommandUrlMap: Record<string, string>,
      display: Record<string, unknown> | null,
      assets: Parameters<typeof renderMessageContent>[1] = [],
      assetUrlMap?: Record<string, string>,
    ) {
      return renderMessageContent(
        content,
        assets,
        assetUrlMap,
        imageCommandUrlMap,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        display,
      )
    }

    function parseRendererState(result: ReturnType<typeof renderWithImageDisplay>) {
      const html = renderToStaticMarkup(result as React.ReactElement)
      const match = html.match(/data-state="([^"]+)"/)
      expect(match).toBeTruthy()

      return JSON.parse(match![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as {
        runtime: {
          image: Record<string, unknown>
        }
      }
    }

    it('renders UGCRenderer when valid image_display is provided', () => {
      const content = '<img="happy">'
      const assets = [
        { id: '1', display_name: 'happy', file_name: 'happy.png', storage_path: 'x' },
      ] as Parameters<typeof renderMessageContent>[1]

      const result = renderWithImageDisplay(
        content,
        { happy: 'https://cdn/happy.png' },
        validImageDisplay,
        assets,
      )

      const html = renderToStaticMarkup(result as React.ReactElement)
      expect(html).toContain('data-testid="ugc-renderer"')
      expect(html).toContain('@assets/emotion')
      expect(html).toContain('https://cdn/happy.png')
      // Should NOT contain hardcoded next/image
      expect(html).not.toContain('width="400"')
    })

    it('injects asset metadata into UGCRenderer state', () => {
      const assetUrl = 'https://cdn/hero-angry.png'
      const assets = [
        {
          id: 'hero-angry',
          display_name: 'Hero Angry',
          canonical_name: 'Hero.angry',
          file_name: 'hero_angry.png',
          storage_path: 'user/hero_angry.png',
          metadata: {
            aliases: ['hero_angry'],
            ui: {
              character: 'Hero',
              variant: 'angry',
              theme: 'knight',
              flags: { nsfw: false },
              tokens: { borderColor: '#c9a84c' },
            },
          },
        },
      ] as Parameters<typeof renderMessageContent>[1]

      const state = parseRendererState(
        renderWithImageDisplay(
          '<img="hero_angry">',
          { hero_angry: assetUrl },
          validImageDisplay,
          assets,
          { hero_angry: assetUrl, 'hero_angry.png': assetUrl },
        ),
      )

      expect(state.runtime.image.rawTag).toBe('hero_angry')
      expect(state.runtime.image.resolvedUrl).toBe(assetUrl)
      expect(state.runtime.image.resolvedBy).toBe('image_command')
      expect(state.runtime.image.character).toBe('Hero')
      expect(state.runtime.image.variant).toBe('angry')
      expect(state.runtime.image.theme).toBe('knight')
      expect((state.runtime.image.tokens as Record<string, unknown>).borderColor).toBe('#c9a84c')
      expect(state.runtime.image.asset).toEqual({
        id: 'hero-angry',
        fileName: 'hero_angry.png',
        displayName: 'Hero Angry',
        canonicalName: 'Hero.angry',
      })
    })

    it('falls back to canonical_name parsing when asset ui metadata is missing', () => {
      const assets = [
        {
          id: 'char-1',
          display_name: null,
          canonical_name: 'Choi Yoo-jin worried',
          file_name: 'choi-yoo-jin-worried.png',
          storage_path: 'user/choi-yoo-jin-worried.png',
          metadata: null,
        },
      ] as Parameters<typeof renderMessageContent>[1]

      const state = parseRendererState(
        renderWithImageDisplay('<img="Choi Yoo-jin worried">', {}, validImageDisplay, assets),
      )

      expect(state.runtime.image.resolvedBy).toBe('asset_tag')
      expect(state.runtime.image.character).toBe('Choi Yoo-jin')
      expect(state.runtime.image.variant).toBe('worried')
      expect(state.runtime.image.canonicalName).toBe('Choi Yoo-jin worried')
    })

    it('injects minimal runtime state when only image command resolution is available', () => {
      const assetUrl = 'https://cdn/mood.png'
      const state = parseRendererState(
        renderWithImageDisplay('<img="mood">', { mood: assetUrl }, validImageDisplay),
      )

      expect(state.runtime.image.rawTag).toBe('mood')
      expect(state.runtime.image.resolvedUrl).toBe(assetUrl)
      expect(state.runtime.image.resolvedBy).toBe('image_command')
      expect(state.runtime.image.asset).toBeUndefined()
    })

    it('falls back to <Image> when image_display has empty views', () => {
      const content = '<img="happy">'
      const invalidDisplay = {
        meta: { name: 'bad', version: '1.0.0' },
        views: {},
      }

      const result = renderWithImageDisplay(
        content,
        { happy: 'https://cdn/happy.png' },
        invalidDisplay,
      )

      const html = renderToStaticMarkup(result as React.ReactElement)
      // Should fall back to hardcoded Image, not UGCRenderer
      expect(html).not.toContain('data-testid="ugc-renderer"')
      expect(html).toContain('happy.png')
    })

    it('falls back to <Image> when image_display view has no type', () => {
      const content = '<img="smile">'
      const brokenDisplay = {
        meta: { name: 'broken', version: '1.0.0' },
        views: { Main: { children: [] } }, // missing type
      }

      const result = renderWithImageDisplay(
        content,
        { smile: 'https://cdn/smile.png' },
        brokenDisplay,
      )

      const html = renderToStaticMarkup(result as React.ReactElement)
      expect(html).not.toContain('data-testid="ugc-renderer"')
      expect(html).toContain('smile.png')
    })

    it('renders hardcoded <Image> when no image_display is provided', () => {
      const content = '<img="wave">'

      const result = renderMessageContent(content, [], undefined, { wave: 'https://cdn/wave.png' })

      const html = renderToStaticMarkup(result as React.ReactElement)
      expect(html).not.toContain('data-testid="ugc-renderer"')
      expect(html).toContain('wave.png')
    })

    it('does not feed inline cards from generic assetUrlMap when the server omitted unsafe legacy URLs', () => {
      const inlineCard = {
        meta: { name: 'legacy-assets', version: '1.0.0' },
        state: {},
        assets: {
          portrait: '@assets/legacy pose.png',
        },
        views: { Main: { type: 'Column', children: [] } },
      }
      const regex = [
        {
          type: 'extract' as const,
          comment: 'legacy assets',
          in: '\\[LegacyAsset\\]',
          out: '',
          ableFlag: true,
          bindings: {},
        },
      ]

      const node = renderMessageContent(
        '[LegacyAsset]',
        [],
        {},
        undefined,
        regex,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        inlineCard,
      )

      const html = renderToStaticMarkup(<>{node}</>)
      expect(html).toContain('data-testid="ugc-renderer"')
      expect(html).toContain('data-assets="{}"')
      expect(html).not.toContain('legacy-pose.png')
    })
  })
})
