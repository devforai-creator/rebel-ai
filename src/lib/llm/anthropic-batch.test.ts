import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAnthropicMessageBatch,
  extractTextFromAnthropicBatchMessage,
  retrieveAnthropicBatchResult,
  retrieveAnthropicMessageBatch,
} from './anthropic-batch'

describe('Anthropic batch API helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a message batch with the expected request shape', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msgbatch_1',
          type: 'message_batch',
          processing_status: 'in_progress',
          ended_at: null,
          created_at: '2026-04-10T00:00:00Z',
          expires_at: '2026-04-11T00:00:00Z',
          cancel_initiated_at: null,
          results_url: null,
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const batch = await createAnthropicMessageBatch({
      apiKey: 'sk-ant-test',
      customId: 'job-1',
      params: {
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    expect(batch.id).toBe('msgbatch_1')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages/batches',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              custom_id: 'job-1',
              params: {
                model: 'claude-opus-4-6',
                max_tokens: 1024,
                messages: [{ role: 'user', content: 'hello' }],
              },
            },
          ],
        }),
      }),
    )
  })

  it('retrieves a message batch', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msgbatch_1',
          type: 'message_batch',
          processing_status: 'ended',
          ended_at: '2026-04-10T00:01:00Z',
          created_at: '2026-04-10T00:00:00Z',
          expires_at: '2026-04-11T00:00:00Z',
          cancel_initiated_at: null,
          results_url: 'https://api.anthropic.com/result.jsonl',
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const batch = await retrieveAnthropicMessageBatch({
      apiKey: 'sk-ant-test',
      batchId: 'msgbatch_1',
    })

    expect(batch.processing_status).toBe('ended')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages/batches/msgbatch_1',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('selects the matching JSONL result by custom id', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        [
          JSON.stringify({
            custom_id: 'other',
            result: { type: 'expired' },
          }),
          JSON.stringify({
            custom_id: 'job-1',
            result: {
              type: 'succeeded',
              message: {
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                model: 'claude-opus-4-6',
                content: [{ type: 'text', text: 'done' }],
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 3 },
              },
            },
          }),
        ].join('\n'),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await retrieveAnthropicBatchResult({
      apiKey: 'sk-ant-test',
      resultsUrl: 'https://api.anthropic.com/result.jsonl',
      customId: 'job-1',
    })

    expect(result?.custom_id).toBe('job-1')
    if (result?.result.type !== 'succeeded') {
      throw new Error('expected succeeded result')
    }
    expect(extractTextFromAnthropicBatchMessage(result.result.message)).toBe('done')
  })
})
