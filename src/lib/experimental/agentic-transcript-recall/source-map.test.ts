import { describe, expect, it } from 'vitest'

import { deriveAgenticTranscriptRecallSourceHints } from './source-hints'
import { deriveAgenticTranscriptRecallSourceMap } from './source-map'

describe('deriveAgenticTranscriptRecallSourceMap', () => {
  const runtimeConfig = {
    maxMessagesPerCall: 12,
    maxTotalMessages: 12,
  } as const

  it('returns empty buckets when no surfaced ranges exist', () => {
    expect(
      deriveAgenticTranscriptRecallSourceMap({
        sourceHints: {
          rawContextStartOrdinal: 1,
          cutoffOrdinal: 0,
          hints: [],
        },
        runtimeConfig,
      }),
    ).toEqual({
      rawContextStartOrdinal: 1,
      cutoffOrdinal: 0,
      directFetchRanges: [],
      navigationParents: [],
    })
  })

  it('keeps direct summary chunks fetchable when no navigation parent is needed', () => {
    expect(
      deriveAgenticTranscriptRecallSourceMap({
        sourceHints: {
          rawContextStartOrdinal: 21,
          cutoffOrdinal: 20,
          hints: [
            {
              kind: 'summary',
              label: 'summary',
              startSeq: 1,
              endSeq: 10,
              preview: 'Chunk 1',
            },
            {
              kind: 'summary',
              label: 'summary',
              startSeq: 11,
              endSeq: 20,
              preview: 'Chunk 2',
            },
          ],
        },
        runtimeConfig,
      }),
    ).toEqual({
      rawContextStartOrdinal: 21,
      cutoffOrdinal: 20,
      directFetchRanges: [
        {
          kind: 'summary',
          label: 'summary',
          startSeq: 1,
          endSeq: 10,
          preview: 'Chunk 1',
        },
        {
          kind: 'summary',
          label: 'summary',
          startSeq: 11,
          endSeq: 20,
          preview: 'Chunk 2',
        },
      ],
      navigationParents: [],
    })
  })

  it('derives navigation parents with multiple eligible direct-fetch child ranges', () => {
    expect(
      deriveAgenticTranscriptRecallSourceMap({
        sourceHints: {
          rawContextStartOrdinal: 21,
          cutoffOrdinal: 20,
          hints: [
            {
              kind: 'summary',
              label: 'summary',
              startSeq: 1,
              endSeq: 10,
              preview: 'Chunk 1',
            },
            {
              kind: 'summary',
              label: 'summary',
              startSeq: 11,
              endSeq: 20,
              preview: 'Chunk 2',
            },
            {
              kind: 'summary',
              label: 'meta_summary',
              startSeq: 1,
              endSeq: 20,
              preview: 'Meta parent',
            },
          ],
        },
        runtimeConfig,
      }),
    ).toEqual({
      rawContextStartOrdinal: 21,
      cutoffOrdinal: 20,
      directFetchRanges: [
        {
          kind: 'summary',
          label: 'summary',
          startSeq: 1,
          endSeq: 10,
          preview: 'Chunk 1',
        },
        {
          kind: 'summary',
          label: 'summary',
          startSeq: 11,
          endSeq: 20,
          preview: 'Chunk 2',
        },
      ],
      navigationParents: [
        {
          parentRange: {
            kind: 'summary',
            label: 'meta_summary',
            startSeq: 1,
            endSeq: 20,
            preview: 'Meta parent',
          },
          childRanges: [
            {
              kind: 'summary',
              label: 'summary',
              startSeq: 1,
              endSeq: 10,
              preview: 'Chunk 1',
            },
            {
              kind: 'summary',
              label: 'summary',
              startSeq: 11,
              endSeq: 20,
              preview: 'Chunk 2',
            },
          ],
        },
      ],
    })
  })

  it('drops raw-overlapping child ranges while preserving surfaced parents for navigation', () => {
    const sourceHints = deriveAgenticTranscriptRecallSourceHints({
      promptBlocks: [
        {
          role: 'system',
          content: [
            '[Meta Summary 1-30]',
            'Arc parent',
            '',
            '[Summary 1-10]',
            'Chunk 1',
            '',
            '[Summary 11-20]',
            'Chunk 2',
            '',
            '[Summary 21-30]',
            'Already in raw context',
          ].join('\n'),
          cachePreference: 'avoid-cache',
          stability: 'sealed',
        },
      ],
      rawContextStartOrdinal: 21,
    })

    expect(
      deriveAgenticTranscriptRecallSourceMap({
        sourceHints,
        runtimeConfig,
      }),
    ).toEqual({
      rawContextStartOrdinal: 21,
      cutoffOrdinal: 20,
      directFetchRanges: [
        {
          kind: 'summary',
          label: 'summary',
          startSeq: 1,
          endSeq: 10,
          preview: 'Chunk 1',
        },
        {
          kind: 'summary',
          label: 'summary',
          startSeq: 11,
          endSeq: 20,
          preview: 'Chunk 2',
        },
      ],
      navigationParents: [
        {
          parentRange: {
            kind: 'summary',
            label: 'meta_summary',
            startSeq: 1,
            endSeq: 30,
            preview: 'Arc parent',
          },
          childRanges: [
            {
              kind: 'summary',
              label: 'summary',
              startSeq: 1,
              endSeq: 10,
              preview: 'Chunk 1',
            },
            {
              kind: 'summary',
              label: 'summary',
              startSeq: 11,
              endSeq: 20,
              preview: 'Chunk 2',
            },
          ],
        },
      ],
    })
  })

  it('keeps navigation parents even when every surfaced child range is already inside the raw context', () => {
    const sourceHints = deriveAgenticTranscriptRecallSourceHints({
      promptBlocks: [
        {
          role: 'system',
          content: [
            '[Meta Summary 1-40]',
            'Large parent',
            '',
            '[Summary 21-30]',
            'Raw chunk 1',
            '',
            '[Summary 31-40]',
            'Raw chunk 2',
          ].join('\n'),
          cachePreference: 'avoid-cache',
          stability: 'sealed',
        },
      ],
      rawContextStartOrdinal: 21,
    })

    expect(
      deriveAgenticTranscriptRecallSourceMap({
        sourceHints,
        runtimeConfig,
      }),
    ).toEqual({
      rawContextStartOrdinal: 21,
      cutoffOrdinal: 20,
      directFetchRanges: [],
      navigationParents: [
        {
          parentRange: {
            kind: 'summary',
            label: 'meta_summary',
            startSeq: 1,
            endSeq: 40,
            preview: 'Large parent',
          },
          childRanges: [],
        },
      ],
    })
  })
})
