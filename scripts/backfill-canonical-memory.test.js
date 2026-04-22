import { describe, expect, it } from 'vitest'

import {
  analyzeChatMemoryRows,
  main,
  parseArgs,
  resolveChatMemoryConfig,
  resolveSummaryGenerationOrigin,
} from './backfill-canonical-memory.js'

describe('backfill-canonical-memory helpers', () => {
  it('parses repeated and comma-separated chat ids with flags', () => {
    expect(
      parseArgs([
        '--chat-id',
        'chat-a,chat-b',
        '--chat-id',
        'chat-b',
        '--api-key-id',
        'key-1',
        '--model-name',
        'gpt-5.4',
        '--dry-run',
        '--force',
      ]),
    ).toEqual({
      chatIds: ['chat-a', 'chat-b'],
      apiKeyId: 'key-1',
      modelName: 'gpt-5.4',
      origin: null,
      dryRun: true,
      purgeOnly: false,
      force: true,
    })
  })

  it('resolves origin from INTERNAL_API_ORIGIN or localhost fallback', () => {
    expect(
      resolveSummaryGenerationOrigin({
        env: {
          INTERNAL_API_ORIGIN: 'https://internal.example.com',
          NODE_ENV: 'production',
        },
      }),
    ).toBe('https://internal.example.com')

    expect(
      resolveSummaryGenerationOrigin({
        env: {
          NODE_ENV: 'development',
        },
      }),
    ).toBe('http://127.0.0.1:3000')
  })

  it('flags malformed legacy prefix ranges and missing canonical facts/meta', () => {
    const analysis = analyzeChatMemoryRows({
      summaryRows: [
        { level: 0, start_seq: 1, end_seq: 96 },
        { level: 1, start_seq: 1, end_seq: 96 },
      ],
      factRows: [{ start_seq: 1, end_seq: 96 }],
      totalMessages: 104,
      memoryConfig: resolveChatMemoryConfig({
        memory: {
          mode: 'prefix_live_blocks',
          sealEveryMessages: 100,
          retainTailMessages: 4,
        },
      }),
    })

    expect(analysis.needsRebuild).toBe(true)
    expect(analysis.issues).toEqual([
      'malformed_chunk_ranges',
      'malformed_meta_ranges',
      'malformed_fact_ranges',
    ])
  })

  it('flags missing facts and missing meta for canonical chunk rows', () => {
    const analysis = analyzeChatMemoryRows({
      summaryRows: Array.from({ length: 10 }, (_, index) => ({
        level: 0,
        start_seq: index * 10 + 1,
        end_seq: index * 10 + 10,
      })),
      factRows: [],
      totalMessages: 104,
      memoryConfig: resolveChatMemoryConfig({
        memory: {
          mode: 'prefix_live_blocks',
        },
      }),
      episodicMemoryEnabled: true,
    })

    expect(analysis.needsRebuild).toBe(true)
    expect(analysis.issues).toEqual(['missing_fact_ranges', 'missing_meta_ranges'])
    expect(analysis.missingFactRanges).toHaveLength(10)
    expect(analysis.missingMetaRanges).toEqual([{ start_seq: 1, end_seq: 100 }])
  })

  it('does not flag missing facts for episodic-RAG-off chats', () => {
    const analysis = analyzeChatMemoryRows({
      summaryRows: Array.from({ length: 10 }, (_, index) => ({
        level: 0,
        start_seq: index * 10 + 1,
        end_seq: index * 10 + 10,
      })),
      factRows: [],
      totalMessages: 104,
      memoryConfig: resolveChatMemoryConfig({
        memory: {
          mode: 'prefix_live_blocks',
        },
      }),
      episodicMemoryEnabled: false,
    })

    expect(analysis.needsRebuild).toBe(true)
    expect(analysis.issues).toEqual(['missing_meta_ranges'])
    expect(analysis.missingFactRanges).toEqual([])
    expect(analysis.missingMetaRanges).toEqual([{ start_seq: 1, end_seq: 100 }])
  })

  it('flags missing canonical chunk coverage when early chunks are absent', () => {
    const analysis = analyzeChatMemoryRows({
      summaryRows: [{ level: 0, start_seq: 11, end_seq: 20 }],
      factRows: [{ start_seq: 11, end_seq: 20 }],
      totalMessages: 24,
      memoryConfig: resolveChatMemoryConfig({
        memory: {
          mode: 'summary_window',
        },
      }),
    })

    expect(analysis.needsRebuild).toBe(true)
    expect(analysis.issues).toContain('missing_chunk_ranges')
    expect(analysis.missingChunkRanges).toEqual([{ start_seq: 1, end_seq: 10 }])
  })

  it('does not over-report missing summary_window chunks beyond the live-tail cutoff', () => {
    const analysis = analyzeChatMemoryRows({
      summaryRows: [{ level: 0, start_seq: 1, end_seq: 10 }],
      factRows: [],
      totalMessages: 24,
      memoryConfig: resolveChatMemoryConfig({
        memory: {
          mode: 'summary_window',
        },
      }),
      episodicMemoryEnabled: false,
    })

    expect(analysis.needsRebuild).toBe(false)
    expect(analysis.issues).toEqual([])
    expect(analysis.missingChunkRanges).toEqual([])
  })

  it('flags missing artifacts when a chat is large enough but has no rows at all', () => {
    const analysis = analyzeChatMemoryRows({
      summaryRows: [],
      factRows: [],
      totalMessages: 24,
      memoryConfig: resolveChatMemoryConfig({
        memory: {
          mode: 'summary_window',
        },
      }),
    })

    expect(analysis.needsRebuild).toBe(true)
    expect(analysis.issues).toEqual(['missing_all_artifacts'])
  })

  it('does not require INTERNAL_API_ORIGIN during dry-run', async () => {
    const logs = []
    function createOrderedQuery(data) {
      return {
        order() {
          return this
        },
        then(resolve) {
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
    }

    const supabase = {
      from(table) {
        switch (table) {
          case 'chats':
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: { id: 'chat-1', user_id: 'user-1', model_config: null },
                    error: null,
                  }),
                }),
              }),
            }
          case 'chat_summaries':
          case 'chat_facts':
            return {
              select: () => ({
                eq: () => ({
                  order: () => createOrderedQuery([]),
                }),
              }),
            }
          case 'profiles':
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { enable_episodic_rag: false },
                    error: null,
                  }),
                }),
              }),
            }
          case 'chat_turns':
            return {
              select: () => ({
                eq: () => ({
                  order: () =>
                    createOrderedQuery(
                      Array.from({ length: 12 }, (_, index) => ({
                        user_message_id: `user-${index}`,
                        active_assistant_message_id: `assistant-${index}`,
                      })),
                    ),
                }),
              }),
            }
          default:
            throw new Error(`Unexpected table ${table}`)
        }
      },
    }

    await expect(
      main(['--chat-id', 'chat-1', '--dry-run'], {
        env: {
          NODE_ENV: 'production',
        },
        supabase,
        console: {
          log: (message) => logs.push(message),
        },
      }),
    ).resolves.toBe(0)

    expect(logs).toContain('  action: dry-run')
  })
})
