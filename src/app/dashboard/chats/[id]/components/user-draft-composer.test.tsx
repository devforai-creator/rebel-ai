// @vitest-environment jsdom

import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer } from './ChatComposer'
import { useUserDraft } from '../hooks/useUserDraft'
import type { UserDraftUsage } from '@/lib/chat/user-draft-contract'

const usage: UserDraftUsage = {
  provider: 'deepseek',
  modelName: 'deepseek-v4-flash',
  memoryMode: 'prefix_live_blocks',
  inputTokens: 10000,
  outputTokens: 200,
  cacheHitTokens: 8000,
  cacheMissTokens: 2000,
}

const fetchMock = vi.fn()
const onSubmit = vi.fn((event?: React.FormEvent<HTMLFormElement>) => event?.preventDefault())
function Harness({
  initialInput = '',
  provider = 'openai',
  modelName = 'gpt-5.4',
  chatId = 'chat-1',
  contextKey = 'turn-1',
  isChatLoading = false,
}: {
  initialInput?: string
  provider?: string
  modelName?: string
  chatId?: string
  contextKey?: string
  isChatLoading?: boolean
}) {
  const [input, setInput] = useState(initialInput)
  const draft = useUserDraft({
    chatId,
    apiKeyId: 'key-1',
    modelName,
    provider,
    contextKey,
    input,
    isChatLoading,
    replaceInput: setInput,
  })
  return (
    <ChatComposer
      composerRef={{ current: null }}
      input={input}
      isLoading={isChatLoading}
      onInputChange={(event) => setInput(event.target.value)}
      onQuickInsert={(text) => setInput((previous) => previous + text)}
      onSubmit={onSubmit}
      isDrafting={draft.isDrafting}
      onGenerateDraft={draft.generateDraft}
      draftDisabledReason={draft.disabledReason}
      draftError={draft.error}
      draftUsage={draft.usage}
      onCancelDraft={draft.cancelDraft}
      onRestoreDraftInput={draft.canRestore ? draft.restoreInput : undefined}
    />
  )
}
function composer() {
  return screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement
}
function pendingRequest() {
  let resolve!: (response: Response) => void
  fetchMock.mockReturnValue(
    new Promise<Response>((done) => {
      resolve = done
    }),
  )
  return (content = 'generated user message', usage?: UserDraftUsage) =>
    act(async () => resolve(Response.json({ content, usage })))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(Response.json({ content: 'generated user message' }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('user draft composer', () => {
  it('shows the last draft cache usage and hides it when switching chats', async () => {
    fetchMock.mockResolvedValue(Response.json({ content: 'generated user message', usage }))
    const view = render(<Harness provider="deepseek" modelName="deepseek-v4-flash" />)
    fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
    await waitFor(() => expect(composer().value).toBe('generated user message'))
    expect(screen.getByText('대필 사용량 · 캐시 적중률 80.0%')).toBeTruthy()
    expect(screen.getByText('8,000')).toBeTruthy()
    expect(screen.getByText('2,000')).toBeTruthy()
    expect(screen.getByText(/DeepSeek · deepseek-v4-flash · Prefix/)).toBeTruthy()
    view.rerender(<Harness provider="deepseek" modelName="deepseek-v4-flash" chatId="chat-2" />)
    expect(screen.queryByText(/대필 사용량/)).toBeNull()
  })

  it('shows unknown usage as unreported and preserves an explicit zero cache hit', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        content: 'first draft',
        usage: { ...usage, inputTokens: null, cacheHitTokens: null, cacheMissTokens: null },
      }),
    )
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
    await waitFor(() => expect(screen.getByText('대필 사용량 · 캐시 적중률 미확인')).toBeTruthy())
    expect(screen.getAllByText('미확인')).toHaveLength(3)
    fetchMock.mockResolvedValue(
      Response.json({
        content: 'second draft',
        usage: { ...usage, cacheHitTokens: 0, cacheMissTokens: 10000 },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
    await waitFor(() => expect(screen.getByText('대필 사용량 · 캐시 적중률 0.0%')).toBeTruthy())
    expect(screen.getByText('0')).toBeTruthy()
  })

  it('ignores usage from a canceled response', async () => {
    const finish = pendingRequest()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    await finish('late draft', usage)
    expect(screen.queryByText(/대필 사용량/)).toBeNull()
  })

  it('keeps a valid draft when optional usage is malformed', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        content: 'generated user message',
        usage: { ...usage, cacheHitTokens: -1 },
      }),
    )
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
    await waitFor(() => expect(composer().value).toBe('generated user message'))
    expect(screen.queryByText(/대필 사용량/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['', '상대의 주장에 반박한다'])(
    'fills the composer for input %j without auto-sending',
    async (input) => {
      render(<Harness initialInput={input} />)
      fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
      await waitFor(() => expect(composer().value).toBe('generated user message'))
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/chats/chat-1/user-draft')
      expect(JSON.parse(init.body).instruction).toBe(input)
      expect(JSON.parse(init.body)).toMatchObject({ apiKeyId: 'key-1', modelName: 'gpt-5.4' })
      expect(onSubmit).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
      expect(onSubmit).toHaveBeenCalledTimes(1)
    },
  )

  it('restores the original input after generating', async () => {
    render(<Harness initialInput="원래 의도" />)
    fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
    await waitFor(() => expect(composer().value).toBe('generated user message'))
    fireEvent.click(screen.getByRole('button', { name: '원문 복원' }))
    expect(composer().value).toBe('원래 의도')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps the original text and exposes an error when generation fails', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: '모델 요청에 실패했습니다.' }, { status: 502 }),
    )
    render(<Harness initialInput="원래 의도" />)
    fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('모델 요청에 실패했습니다.'),
    )
    expect(composer().value).toBe('원래 의도')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('allows typing during generation and ignores the stale response', async () => {
    const finish = pendingRequest()
    render(<Harness initialInput="원래 의도" />)
    fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    fireEvent.change(composer(), { target: { value: '직접 수정한 내용' } })
    expect(signal.aborted).toBe(true)
    await finish()
    expect(composer().value).toBe('직접 수정한 내용')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels generation without applying a late result', async () => {
    const finish = pendingRequest()
    render(<Harness initialInput="의도" />)
    fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    await finish()
    expect(composer().value).toBe('의도')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    { modelName: 'another-model' },
    { chatId: 'chat-2' },
    { contextKey: 'turn-2' },
    { isChatLoading: true },
  ])('invalidates generation when its scope changes: %j', async (change) => {
    const finish = pendingRequest()
    const view = render(<Harness initialInput="의도" />)
    fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
    view.rerender(<Harness initialInput="의도" {...change} />)
    await finish()
    expect(composer().value).toBe('의도')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('blocks Enter and duplicate generation while a draft is pending', async () => {
    const finish = pendingRequest()
    render(<Harness initialInput="의도" />)
    fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: false })
    expect(
      (screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '작성 중...' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    await finish()
  })

  it('does not call the draft API for local models', () => {
    render(<Harness provider="local" modelName="local-rp-base" />)
    const button = screen.getByRole('button', { name: '대신 작성' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('클라우드 모델')
    fireEvent.click(button)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts an in-flight request on unmount', async () => {
    const finish = pendingRequest()
    const view = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '대신 작성' }))
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
    await finish()
  })
})
