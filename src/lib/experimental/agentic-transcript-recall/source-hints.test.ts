import { describe, expect, it } from 'vitest'

import { deriveAgenticTranscriptRecallSourceHints } from './source-hints'

describe('deriveAgenticTranscriptRecallSourceHints', () => {
  it('returns no hints when the prompt has no sealed summary or fact ranges', () => {
    expect(
      deriveAgenticTranscriptRecallSourceHints({
        promptBlocks: [
          {
            role: 'system',
            content: 'STATIC',
            cachePreference: 'prefer-cache',
            stability: 'static',
          },
          {
            role: 'user',
            content: '[Summary 1-10] not a system block',
            cachePreference: 'avoid-cache',
            stability: 'live',
          },
        ],
        rawContextStartOrdinal: 1,
      }),
    ).toEqual({
      rawContextStartOrdinal: 1,
      cutoffOrdinal: 0,
      hints: [],
    })
  })

  it('derives summary and fact ranges from sealed system blocks and ignores unrelated text', () => {
    expect(
      deriveAgenticTranscriptRecallSourceHints({
        promptBlocks: [
          {
            role: 'system',
            content: [
              '=== Previous Conversation Summary ===',
              '[Summary 1-10]',
              'The pair met at the station.',
              '',
              '[Meta Summary 1-20]',
              'The first arc established their conflict.',
            ].join('\n'),
            cachePreference: 'avoid-cache',
            stability: 'sealed',
          },
          {
            role: 'system',
            content: [
              '=== Key Facts to Remember ===',
              '[11-20]',
              'Mina promised not to leave without warning.',
              '',
              '=== Lorebook ===',
              'Moon phase: waxing',
            ].join('\n'),
            cachePreference: 'prefer-cache',
            stability: 'sealed',
          },
        ],
        rawContextStartOrdinal: 21,
      }),
    ).toEqual({
      rawContextStartOrdinal: 21,
      cutoffOrdinal: 20,
      hints: [
        {
          kind: 'summary',
          label: 'summary',
          startSeq: 1,
          endSeq: 10,
          preview: 'The pair met at the station.',
        },
        {
          kind: 'summary',
          label: 'meta_summary',
          startSeq: 1,
          endSeq: 20,
          preview: 'The first arc established their conflict.',
        },
        {
          kind: 'fact',
          label: null,
          startSeq: 11,
          endSeq: 20,
          preview: 'Mina promised not to leave without warning.',
        },
      ],
    })
  })

  it('filters out ranges that overlap the current raw context and deduplicates duplicates', () => {
    expect(
      deriveAgenticTranscriptRecallSourceHints({
        promptBlocks: [
          {
            role: 'system',
            content: [
              '[Summary 1-10]',
              'Old summary',
              '',
              '[11-20]',
              'Old fact',
              '',
              '[Summary 21-30]',
              'Should be excluded because raw context already starts at 21',
            ].join('\n'),
            cachePreference: 'avoid-cache',
            stability: 'sealed',
          },
          {
            role: 'system',
            content: ['[11-20]', 'Old fact duplicate'].join('\n'),
            cachePreference: 'prefer-cache',
            stability: 'sealed',
          },
        ],
        rawContextStartOrdinal: 21,
      }),
    ).toEqual({
      rawContextStartOrdinal: 21,
      cutoffOrdinal: 20,
      hints: [
        {
          kind: 'summary',
          label: 'summary',
          startSeq: 1,
          endSeq: 10,
          preview: 'Old summary',
        },
        {
          kind: 'fact',
          label: null,
          startSeq: 11,
          endSeq: 20,
          preview: 'Old fact',
        },
      ],
    })
  })
})
