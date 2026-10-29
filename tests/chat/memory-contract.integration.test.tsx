/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CHAT_DELIVERY_MODE_STREAMING } from '@/lib/chat/delivery-mode'
import { CHAT_JOB_PAYLOAD_VERSION } from '@/lib/chat/job-payload'
import { loadChatJobExecutionContext } from '@/app/api/internal/chat-job-runner/execution-context'
import ChatSummariesPanelLoader from '@/app/dashboard/chats/[id]/ChatSummariesPanelLoader'
import { GET as getStats } from '@/app/api/chats/[chatId]/stats/route'
import { generateUserDraft } from '@/lib/chat/user-draft-service'
import { loadMemoryState, type MemorySummaryRow } from '@/lib/chat-memory/load-memory-state'
import type { ServerSupabaseClient } from '@/lib/chat-summaries/types'
import { createMemoryConversation } from './memory-fixtures'

// Only I/O boundaries are replaced. Projection, loaders, memory builders, hooks and UI are real.
const mocks = vi.hoisted(() => ({ client: vi.fn(), refresh: vi.fn(), generate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
vi.mock('@/lib/supabase/client', () => ({ createClient: mocks.client }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/app/api/internal/chat-job-runner/vault', () => ({
  decryptSecret: vi.fn().mockResolvedValue('test-secret'),
}))
vi.mock('@/lib/llm/language-model-access', () => ({
  createLanguageModelFromSecretConfig: vi.fn().mockResolvedValue({ id: 'test-model' }),
  resolveLanguageModelApiKey: vi.fn().mockResolvedValue('test-secret'),
}))
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: mocks.generate,
}))

function ranges(text: string | null) {
  return [...(text ?? '').matchAll(/\[(Meta Summary|Summary) (\d+)-(\d+)\]/g)]
    .map((match) => `${match[1] === 'Meta Summary' ? 1 : 0}:${match[2]}-${match[3]}`)
    .sort()
}

function promptBadges() {
  return screen
    .queryAllByRole('article')
    .filter((card) => within(card).queryByText('In prompt'))
    .map((card) => {
      const match = card.textContent?.match(/(Meta Summary|Chunk Summary) · (\d+)-(\d+)/)
      if (!match) throw new Error('Missing summary range on an In prompt card')
      return `${match[1] === 'Meta Summary' ? 1 : 0}:${match[2]}-${match[3]}`
    })
    .sort()
}

function expectCompleteCoverage(
  summaryText: string | null,
  rawMessages: Array<{ messageId?: string | null }>,
  total: number,
) {
  const spans = [
    ...[...(summaryText ?? '').matchAll(/\[(?:Meta Summary|Summary) (\d+)-(\d+)\]/g)].map(
      (match) => ({ start: Number(match[1]), end: Number(match[2]) }),
    ),
    ...rawMessages.map((message) => {
      const ordinal = Number(message.messageId?.replace('msg-', ''))
      return { start: ordinal, end: ordinal }
    }),
  ].sort((a, b) => a.start - b.start)
  let covered = 0
  for (const span of spans) {
    expect(span.start).toBeLessThanOrEqual(covered + 1)
    expect(span.end).toBeLessThanOrEqual(total)
    covered = Math.max(covered, span.end)
  }
  expect(covered).toBe(total)
}

async function execution(client: ServerSupabaseClient, turnId: string, regeneration = false) {
  return loadChatJobExecutionContext({
    supabase: client,
    payload: {
      version: CHAT_JOB_PAYLOAD_VERSION,
      requestId: 'memory-contract-request',
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
      sanitizedMessages: [],
      turnId,
      isRegeneration: regeneration,
      regenerateAssistantMessageId: regeneration ? 'previous-assistant' : null,
    },
    timings: {},
  })
}

async function mountPanel() {
  const element = await ChatSummariesPanelLoader({ chatId: 'chat-1' })
  const mounted = render(element)
  const toggle = screen.queryByRole('button', { name: /Summary Structure/ })
  if (toggle) fireEvent.click(toggle)
  for (const button of screen.queryAllByRole('button', { name: /Chunk Summaries/ })) {
    fireEvent.click(button)
  }
  return { ...mounted, element }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED', 'false')
  vi.stubEnv('OPENAI_PROMPT_CACHE_MODE', 'off')
  vi.stubEnv('GOOGLE_EXPLICIT_CACHE_MODE', 'off')
  mocks.generate.mockResolvedValue({
    text: 'A complete user draft.',
    finishReason: 'stop',
    usage: {},
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('server and UI memory contract', () => {
  it.each([
    { count: 53, chunkCount: 5, boundary: 0 },
    { count: 54, boundary: 50 },
    { count: 103, boundary: 50 },
    { count: 104, boundary: 100 },
    { count: 154, boundary: 150 },
    { count: 204, boundary: 200 },
    { count: 54, chunkCount: 4, boundary: 0 },
    { count: 54, missingChunkStart: 21, boundary: 0 },
    { count: 54, clearLastAssistant: true, boundary: 0 },
  ])('agrees on summaries and raw coverage for $count messages: $boundary', async (scenario) => {
    const { client, messages, lastTurnId } = createMemoryConversation(scenario)
    mocks.client.mockReturnValue(client)
    const effectiveCount = scenario.count - (scenario.clearLastAssistant ? 1 : 0)
    const server = await execution(client, lastTurnId, scenario.clearLastAssistant)
    const { element } = await mountPanel()

    expect(element.props.totalMessages).toBe(effectiveCount)
    expect(server.debugMetrics.memory_visible_summary_end).toBe(scenario.boundary)
    expect(server.recentMessages.map((message) => message.messageId)).toEqual(
      messages.slice(scenario.boundary, effectiveCount).map((message) => message.id),
    )
    expect(promptBadges()).toEqual(ranges(server.dynamicContext))
    expect(server.recentMessages.length).toBe(effectiveCount - scenario.boundary)
    expectCompleteCoverage(server.dynamicContext, server.recentMessages, effectiveCount)
    expect(JSON.stringify(server.promptBlocks)).not.toContain('not in the active conversation')

    // Test the actual draft entry point through its outbound provider request too.
    await generateUserDraft({
      supabase: client,
      getAdminClient: () => client,
      userId: 'user-1',
      chatId: 'chat-1',
      request: { apiKeyId: 'key-1', modelName: 'gpt-4o-mini', instruction: '' },
      signal: new AbortController().signal,
    })
    expect(ranges(JSON.stringify(mocks.generate.mock.calls[0][0]))).toEqual(promptBadges())
  })

  it('counts only the active conversation during the real UI stats refresh', async () => {
    const { client, lastTurnId } = createMemoryConversation({ count: 53, chunkCount: 5 })
    mocks.client.mockReturnValue(client)
    const server = await execution(client, lastTurnId)
    await mountPanel()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        getStats(new Request('http://local/stats'), {
          params: Promise.resolve({ chatId: 'chat-1' }),
        }),
      ),
    )
    fireEvent.click(screen.getByTitle('Refresh memory panel'))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())

    expect(screen.getByText('Total messages:').textContent).toBe('Total messages: 53')
    expect(promptBadges()).toEqual(ranges(server.dynamicContext))
  })

  it('preserves the same shared artifacts when switching summary and prefix modes', async () => {
    const { client, db, lastTurnId } = createMemoryConversation({ count: 154 })
    mocks.client.mockReturnValue(client)
    const artifacts = JSON.stringify(db.state.chatSummaries)
    const first = await execution(client, lastTurnId)
    await client
      .from('chats')
      .update({ model_config: { memory: { mode: 'summary_window' } } })
      .eq('id', 'chat-1')
    const summary = await execution(client, lastTurnId)
    await mountPanel()
    expect(summary.recentMessages).toHaveLength(20)
    expect(promptBadges()).toEqual([])
    cleanup()

    await client
      .from('chats')
      .update({ model_config: { memory: { mode: 'prefix_live_blocks' } } })
      .eq('id', 'chat-1')
    const prefix = await execution(client, lastTurnId)
    await mountPanel()
    expect(promptBadges()).toEqual(ranges(prefix.dynamicContext))
    expect(ranges(prefix.dynamicContext)).toEqual(ranges(first.dynamicContext))
    expect(JSON.stringify(db.state.chatSummaries)).toBe(artifacts)
  })

  it('loads every summary page for both generation and the actual UI loader', async () => {
    const { client, lastTurnId } = createMemoryConversation({ count: 10054 })
    mocks.client.mockReturnValue(client)
    const server = await execution(client, lastTurnId)
    const panel = await ChatSummariesPanelLoader({ chatId: 'chat-1' })
    expect(panel.props.summaries).toHaveLength(1105)
    expect(panel.props.summaries.some((row: MemorySummaryRow) => row.id === 'chunk-1005')).toBe(
      true,
    )
    expect(server.debugMetrics.memory_visible_summary_end).toBe(10050)
    expect(server.recentMessages).toHaveLength(4)
  })

  it('excludes an assistant only when the regenerated turn still has an active variant', async () => {
    for (const clearLastAssistant of [false, true]) {
      const { client, lastTurnId } = createMemoryConversation({
        count: 54,
        chunkCount: 5,
        clearLastAssistant,
      })
      const state = await loadMemoryState({
        supabase: client,
        chatId: 'chat-1',
        memoryConfig: { mode: 'prefix_live_blocks', retainTailMessages: 4 },
        excludeAssistantForTurnId: lastTurnId,
      })
      expect(state.messageCount).toBe(53)
      expect(state.prefixSummaryState?.visibleSummaryEnd).toBe(0)
    }
  })
})
