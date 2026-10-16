import { beforeEach, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import { buildUsageReceipt } from '@/lib/chat/usage-receipt'
import { estimateUsageCost } from '@/lib/model-pricing'
import { GET } from './route'

const mocks = vi.hoisted(() => ({ client: vi.fn(), latest: vi.fn(), count: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
vi.mock('@/lib/chat/turns', () => ({
  loadLatestProjectedAssistantMessage: mocks.latest,
  countProjectedChatMessages: mocks.count,
}))
const usage = {
  promptTokens: 32691,
  completionTokens: 4128,
  cachedInputTokens: 106687,
  cacheWriteTokens: 2866,
}
const cost = estimateUsageCost({
  ...usage,
  provider: 'anthropic',
  modelName: 'claude-opus-4-7',
  cacheWriteTtl: '1h',
})!
const receipt = buildUsageReceipt({
  requestId: 'correct-request',
  provider: 'anthropic',
  modelName: 'claude-opus-4-7',
  callCount: 2,
  usage,
  cost,
})
const answer = (id: string, debug_info: unknown) => ({
  id,
  prompt_tokens: usage.promptTokens,
  completion_tokens: usage.completionTokens,
  created_at: '2026-10-16T00:00:00Z',
  debug_info,
})
const get = async () =>
  (
    await GET(new Request('http://local/stats'), { params: Promise.resolve({ chatId: 'chat' }) })
  ).json()

beforeEach(() => {
  vi.clearAllMocks()
  const db = createSupabaseMock({
    tables: {
      chats: { rows: [{ id: 'chat', user_id: 'owner' }] },
      chat_summaries: { rows: [] },
      chat_usage_events: {
        rows: [
          {
            chat_id: 'chat',
            user_id: 'owner',
            request_id: 'newer-unrelated',
            total_cost_usd: 99,
            cached_input_tokens: 99999,
          },
          {
            chat_id: 'chat',
            user_id: 'owner',
            request_id: 'correct-request',
            total_cost_usd: 0.3486585,
            cached_input_tokens: 106687,
            model_provider: 'anthropic',
            model_name: 'claude-opus-4-7',
          },
        ],
      },
    },
  })
  mocks.client.mockResolvedValue({
    ...db,
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
  })
  mocks.count.mockResolvedValue(42)
})

it('uses the answer receipt, independent of newer events or delayed event insertion', async () => {
  mocks.latest.mockResolvedValue(answer('answer', { usageReceipt: receipt }))
  const result = await get()
  expect(result.latestMessage).toMatchObject({
    id: 'answer',
    provider: 'anthropic',
    callCount: 2,
    prompt: 142244,
    uncachedPrompt: 32691,
    cachedPrompt: 106687,
    cacheWrite5m: 0,
    cacheWrite1h: 2866,
    promptCostUsd: 0.163455,
    cacheWrite1hCostUsd: 0.02866,
    costUsd: 0.3486585,
  })
})
it('retains the right price after regeneration and deletion of the last answer', async () => {
  const oldReceipt = {
    ...receipt,
    requestId: 'old-request',
    cost: { ...receipt.cost!, total: 0.1 },
  }
  mocks.latest
    .mockResolvedValueOnce(answer('regenerated', { usageOnly: true, usageReceipt: receipt }))
    .mockResolvedValueOnce(answer('previous', { usageOnly: true, usageReceipt: oldReceipt }))
  expect((await get()).latestMessage.costUsd).toBe(0.3486585)
  const afterDelete = (await get()).latestMessage
  expect(afterDelete.id).toBe('previous')
  expect(afterDelete.costUsd).toBe(0.1)
})
it('looks up a legacy record by its exact request ID', async () => {
  mocks.latest.mockResolvedValue(answer('legacy', { requestId: 'correct-request' }))
  expect((await get()).latestMessage).toMatchObject({
    costUsd: 0.3486585,
    cachedPrompt: 106687,
    usageBreakdownAvailable: false,
  })
})
it('shows unknown cost for old answers without identity instead of borrowing another request price', async () => {
  mocks.latest.mockResolvedValue(answer('legacy', null))
  expect((await get()).latestMessage.costUsd).toBeNull()
  mocks.latest.mockResolvedValue(answer('legacy', { requestId: 'missing-request' }))
  expect((await get()).latestMessage.costUsd).toBeNull()
})
it('does not show a deleted answer when there is no active assistant left', async () => {
  mocks.latest.mockResolvedValue(null)
  expect((await get()).latestMessage).toBeNull()
})
it('keeps unpriced models unknown even if an old event stores a zero price', async () => {
  mocks.latest.mockResolvedValue(answer('answer', { usageReceipt: { ...receipt, cost: null } }))
  expect((await get()).latestMessage.costUsd).toBeNull()
})
it('reads an older Google receipt without inventing missing reasoning counts or a total', async () => {
  mocks.latest.mockResolvedValue(
    answer('google-old', {
      usageReceipt: {
        ...receipt,
        provider: 'google',
        modelName: 'gemini-4-argon',
        input: 10000,
        output: 1500,
        uncachedInput: null,
        cachedInput: 8000,
      },
    }),
  )
  expect((await get()).latestMessage).toMatchObject({
    provider: 'google',
    prompt: 10000,
    completion: 1500,
    reasoning: null,
    total: null,
    serviceTier: null,
  })
})
it('includes reported reasoning in a legacy Google event total', async () => {
  const db = createSupabaseMock({
    tables: {
      chats: { rows: [{ id: 'chat', user_id: 'owner' }] },
      chat_summaries: { rows: [] },
      chat_usage_events: {
        rows: [
          {
            chat_id: 'chat',
            user_id: 'owner',
            request_id: 'legacy-google',
            model_provider: 'google',
            model_name: 'gemini-4-argon',
            reasoning_tokens: 500,
            total_cost_usd: 0.0248,
          },
        ],
      },
    },
  })
  mocks.client.mockResolvedValue({
    ...db,
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
  })
  mocks.latest.mockResolvedValue({
    ...answer('google-old', { requestId: 'legacy-google' }),
    prompt_tokens: 10000,
    completion_tokens: 1500,
  })
  expect((await get()).latestMessage).toMatchObject({
    reasoning: 500,
    total: 12000,
    costUsd: 0.0248,
  })
})
it.each(['google', 'openai', 'anthropic', 'deepseek'])(
  'does not preserve a false zero-dollar estimate for %s without usage',
  async (provider) => {
    mocks.latest.mockResolvedValue(
      answer('google-unknown', {
        usageReceipt: {
          ...receipt,
          provider,
          input: null,
          output: null,
          cost: { ...receipt.cost!, total: 0 },
        },
      }),
    )
    expect((await get()).latestMessage.costUsd).toBeNull()
  },
)
it('reads older OpenAI receipts without labeling inclusive output as visible output or inventing cache writes', async () => {
  mocks.latest.mockResolvedValue(
    answer('openai-old', {
      usageReceipt: {
        ...receipt,
        provider: 'openai',
        input: 10000,
        output: 1500,
        cachedInput: 8000,
      },
    }),
  )
  expect((await get()).latestMessage).toMatchObject({
    completion: null,
    reasoning: null,
    cacheWrite: null,
    cacheWriteCostUsd: null,
    usageBreakdownAvailable: false,
    total: 11500,
  })
})
it('reads older DeepSeek receipts without inventing a reasoning split or a pricing period', async () => {
  mocks.latest.mockResolvedValue(
    answer('deepseek-old', {
      usageReceipt: {
        ...receipt,
        provider: 'deepseek',
        modelName: 'deepseek-v4-flash',
        input: 10000,
        output: 1500,
        cachedInput: 8000,
      },
    }),
  )
  expect((await get()).latestMessage).toMatchObject({
    completion: null,
    reasoning: null,
    pricingPeriod: null,
    billingModels: null,
    usageBreakdownAvailable: false,
  })
})
it('suppresses an older DeepSeek estimate when its cache breakdown is missing', async () => {
  mocks.latest.mockResolvedValue(
    answer('deepseek-old', {
      usageReceipt: {
        ...receipt,
        provider: 'deepseek',
        cachedInput: null,
        cost: { ...receipt.cost!, total: 0.00182 },
      },
    }),
  )
  expect((await get()).latestMessage.costUsd).toBeNull()
})
it('also suppresses legacy event costs when DeepSeek cache usage was never reported', async () => {
  const db = createSupabaseMock({
    tables: {
      chats: { rows: [{ id: 'chat', user_id: 'owner' }] },
      chat_summaries: { rows: [] },
      chat_usage_events: {
        rows: [
          {
            chat_id: 'chat',
            user_id: 'owner',
            request_id: 'legacy-deepseek',
            model_provider: 'deepseek',
            model_name: 'deepseek-v4-flash',
            cached_input_tokens: null,
            total_cost_usd: 0.00182,
          },
        ],
      },
    },
  })
  mocks.client.mockResolvedValue({
    ...db,
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
  })
  mocks.latest.mockResolvedValue({
    ...answer('legacy-deepseek', { requestId: 'legacy-deepseek' }),
    prompt_tokens: 10000,
    completion_tokens: 1500,
  })
  expect((await get()).latestMessage).toMatchObject({ costUsd: null, cachedPrompt: null })
})
it('enforces ownership before reading prices', async () => {
  mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } })
  expect(
    (await GET(new Request('http://local/stats'), { params: Promise.resolve({ chatId: 'chat' }) }))
      .status,
  ).toBe(401)
})
