import { describe, expect, it } from 'vitest'
import { buildSummaryPromptStatuses, buildSummaryStructure } from './summary-structure'
import { selectPrefixPromptSummaries } from '@/lib/chat-memory/prefix-summary-selection'

function createSummary({
  id,
  level,
  startSeq,
  endSeq,
}: {
  id: string
  level: number
  startSeq: number
  endSeq: number
}) {
  return {
    id,
    level,
    start_seq: startSeq,
    end_seq: endSeq,
    summary: `${id} summary`,
    created_at: '2026-05-10T00:00:00.000Z',
  }
}

function createChunkSummaries({
  prefix,
  startSeq,
  count = 10,
}: {
  prefix: string
  startSeq: number
  count?: number
}) {
  return Array.from({ length: count }, (_, index) => {
    const chunkStart = startSeq + index * 10

    return createSummary({
      id: `${prefix}-${index + 1}`,
      level: 0,
      startSeq: chunkStart,
      endSeq: chunkStart + 9,
    })
  })
}

describe('buildSummaryStructure', () => {
  it('groups chunk summaries under a containing meta summary', () => {
    const summaries = [
      createSummary({ id: 'meta-1', level: 1, startSeq: 1, endSeq: 100 }),
      createSummary({ id: 'chunk-1', level: 0, startSeq: 1, endSeq: 10 }),
    ]

    const result = buildSummaryStructure(summaries)

    expect(result.metaNodes).toHaveLength(1)
    expect(result.metaNodes[0].children).toHaveLength(1)
    expect(result.metaNodes[0].children[0].id).toBe('chunk-1')
    expect(result.looseChunks).toEqual([])
  })

  it('keeps chunk summaries loose when no meta summary contains them', () => {
    const summaries = [
      createSummary({ id: 'meta-1', level: 1, startSeq: 1, endSeq: 100 }),
      createSummary({ id: 'chunk-1', level: 0, startSeq: 101, endSeq: 110 }),
      createSummary({ id: 'chunk-2', level: 0, startSeq: 111, endSeq: 120 }),
    ]

    const result = buildSummaryStructure(summaries)

    expect(result.metaNodes[0].children).toEqual([])
    expect(result.looseChunks.map((chunk) => chunk.id)).toEqual(['chunk-1', 'chunk-2'])
  })

  it('groups multiple chunk summaries under the same containing meta summary', () => {
    const summaries = [
      createSummary({ id: 'meta-1', level: 1, startSeq: 1, endSeq: 100 }),
      createSummary({ id: 'chunk-1', level: 0, startSeq: 1, endSeq: 10 }),
      createSummary({ id: 'chunk-2', level: 0, startSeq: 11, endSeq: 20 }),
    ]

    const result = buildSummaryStructure(summaries)

    expect(result.metaNodes[0].children.map((child) => child.id)).toEqual(['chunk-1', 'chunk-2'])
  })

  it('groups chunks under their matching meta summaries', () => {
    const summaries = [
      createSummary({ id: 'meta-1', level: 1, startSeq: 1, endSeq: 100 }),
      createSummary({ id: 'meta-2', level: 1, startSeq: 101, endSeq: 200 }),
      createSummary({ id: 'chunk-1', level: 0, startSeq: 111, endSeq: 120 }),
    ]

    const result = buildSummaryStructure(summaries)

    expect(result.metaNodes[0].summary.id).toBe('meta-1')
    expect(result.metaNodes[0].children).toEqual([])
    expect(result.metaNodes[1].summary.id).toBe('meta-2')
    expect(result.metaNodes[1].children.map((child) => child.id)).toEqual(['chunk-1'])
    expect(result.looseChunks).toEqual([])
  })

  it('explains a 250-message memory structure with meta nodes and loose chunks', () => {
    const summaries = [
      createSummary({ id: 'meta-1', level: 1, startSeq: 1, endSeq: 100 }),
      createSummary({ id: 'meta-2', level: 1, startSeq: 101, endSeq: 200 }),
      createSummary({ id: 'chunk-1', level: 0, startSeq: 1, endSeq: 10 }),
      createSummary({ id: 'chunk-2', level: 0, startSeq: 101, endSeq: 110 }),
      createSummary({ id: 'chunk-3', level: 0, startSeq: 201, endSeq: 210 }),
      createSummary({ id: 'chunk-4', level: 0, startSeq: 211, endSeq: 220 }),
      createSummary({ id: 'chunk-5', level: 0, startSeq: 221, endSeq: 230 }),
    ]

    const result = buildSummaryStructure(summaries)

    expect(result.metaNodes.map((node) => node.summary.id)).toEqual(['meta-1', 'meta-2'])
    expect(result.metaNodes[0].children.map((child) => child.id)).toEqual(['chunk-1'])
    expect(result.metaNodes[1].children.map((child) => child.id)).toEqual(['chunk-2'])
    expect(result.looseChunks.map((chunk) => chunk.id)).toEqual(['chunk-3', 'chunk-4', 'chunk-5'])
  })

  it('aligns the 250-message tree with prefix rollover statuses', () => {
    const oldChunks = createChunkSummaries({
      prefix: 'old-chunk',
      startSeq: 1,
    })
    const currentChunks = createChunkSummaries({
      prefix: 'current-chunk',
      startSeq: 101,
    })
    const looseChunks = createChunkSummaries({
      prefix: 'loose-chunk',
      startSeq: 201,
      count: 3,
    })

    const summaries = [
      createSummary({ id: 'meta-1', level: 1, startSeq: 1, endSeq: 100 }),
      createSummary({ id: 'meta-2', level: 1, startSeq: 101, endSeq: 200 }),
      ...oldChunks,
      ...currentChunks,
      ...looseChunks,
    ]

    const structure = buildSummaryStructure(summaries)
    const promptSummaries = selectPrefixPromptSummaries(summaries, 200)
    const promptSummaryIds = new Set(promptSummaries.map((summary) => summary.id))
    const statuses = buildSummaryPromptStatuses(summaries, promptSummaryIds)

    expect(structure.metaNodes[0].children).toHaveLength(10)
    expect(structure.metaNodes[1].children).toHaveLength(10)
    expect(structure.looseChunks).toHaveLength(3)

    expect(statuses['meta-1']).toBe('in_prompt')
    expect(statuses['old-chunk-1']).toBe('stored')
    expect(statuses['meta-2']).toBe('stored')
    expect(statuses['current-chunk-1']).toBe('in_prompt')
    expect(statuses['loose-chunk-1']).toBe('stored')
  })
})

describe('buildSummaryPromptStatuses', () => {
  it('marks prompt summaries separately from stored summaries', () => {
    const summaries = [
      createSummary({ id: 'meta-1', level: 1, startSeq: 1, endSeq: 100 }),
      createSummary({ id: 'meta-2', level: 1, startSeq: 101, endSeq: 200 }),
      createSummary({ id: 'chunk-101', level: 0, startSeq: 101, endSeq: 110 }),
    ]

    const result = buildSummaryPromptStatuses(summaries, new Set(['meta-1', 'chunk-101']))

    expect(result).toEqual({
      'meta-1': 'in_prompt',
      'meta-2': 'stored',
      'chunk-101': 'in_prompt',
    })
  })
})
