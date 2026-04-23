import { describe, expect, it } from 'vitest'
import { buildAgenticTranscriptRecallToolContract } from './tool-contract'

describe('buildAgenticTranscriptRecallToolContract', () => {
  it('returns null when no tool-capable source map is available', () => {
    expect(
      buildAgenticTranscriptRecallToolContract({
        sourceMap: null,
        toolChoice: 'auto',
      }),
    ).toBeNull()
  })

  it('builds a fetch-only contract when direct fetch ranges exist', () => {
    const result = buildAgenticTranscriptRecallToolContract({
      sourceMap: {
        rawContextStartOrdinal: 11,
        cutoffOrdinal: 10,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            rangeId: 'R1',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older context',
          },
        ],
        navigationParents: [],
      },
      toolChoice: 'auto',
    })

    expect(result).toMatchObject({
      tools: [{ name: 'fetch_source_range' }],
      toolChoice: { type: 'auto' },
    })
    expect(result?.tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        rangeId: { type: 'string' },
        reason: { type: 'string' },
      },
    })
  })

  it('builds expand and fetch contracts with required tool choice when requested', () => {
    const result = buildAgenticTranscriptRecallToolContract({
      sourceMap: {
        rawContextStartOrdinal: 301,
        cutoffOrdinal: 300,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            rangeId: 'R1',
            startSeq: 281,
            endSeq: 290,
            preview: 'Later child range',
          },
        ],
        navigationParents: [
          {
            parentRange: {
              kind: 'summary',
              label: 'meta_summary',
              parentId: 'P1',
              startSeq: 201,
              endSeq: 300,
              preview: 'Expanded parent',
            },
            childRanges: [
              {
                kind: 'summary',
                label: 'summary',
                rangeId: 'R1',
                startSeq: 281,
                endSeq: 290,
                preview: 'Later child range',
              },
            ],
          },
        ],
      },
      toolChoice: 'required',
    })

    expect(result).toMatchObject({
      tools: [{ name: 'expand_source_range' }, { name: 'fetch_source_range' }],
      toolChoice: { type: 'required' },
    })
    expect(result?.tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        parentId: { type: 'string' },
        reason: { type: 'string' },
      },
    })
  })
})
