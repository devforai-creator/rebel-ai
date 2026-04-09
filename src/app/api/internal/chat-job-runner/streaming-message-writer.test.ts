import { describe, expect, it, vi } from 'vitest'
import { persistStreamedAssistantMessage } from './streaming-message-writer'

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (error?: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('persistStreamedAssistantMessage', () => {
  it('inserts first chunk and flushes final content once when interval does not trigger', async () => {
    const insertAssistantMessage = vi.fn(async () => 'assistant-1')
    const updateAssistantMessage = vi.fn(async () => undefined)
    const deleteAssistantMessage = vi.fn(async () => undefined)

    const result = await persistStreamedAssistantMessage({
      textStream: ['Hel', 'lo'],
      updateIntervalMs: 10_000,
      now: () => 0,
      insertAssistantMessage,
      updateAssistantMessage,
      deleteAssistantMessage,
    })

    expect(result).toEqual({
      fullText: 'Hello',
      assistantMessageId: 'assistant-1',
      messageInsertDuration: 0,
    })
    expect(insertAssistantMessage).toHaveBeenCalledWith('Hel')
    expect(updateAssistantMessage).toHaveBeenCalledTimes(1)
    expect(updateAssistantMessage).toHaveBeenLastCalledWith('assistant-1', 'Hello')
    expect(deleteAssistantMessage).not.toHaveBeenCalled()
  })

  it('queues only the latest content while update is in flight', async () => {
    const firstUpdate = deferred<void>()
    const insertAssistantMessage = vi.fn(async () => 'assistant-1')
    const updateAssistantMessage = vi
      .fn<(...args: [string, string]) => Promise<void>>()
      .mockImplementationOnce(async () => firstUpdate.promise)
      .mockImplementation(async () => undefined)
    const deleteAssistantMessage = vi.fn(async () => undefined)

    const resultPromise = persistStreamedAssistantMessage({
      textStream: ['a', 'b', 'c'],
      updateIntervalMs: 0,
      now: () => 0,
      insertAssistantMessage,
      updateAssistantMessage,
      deleteAssistantMessage,
    })

    for (let index = 0; index < 5 && updateAssistantMessage.mock.calls.length === 0; index += 1) {
      await Promise.resolve()
    }
    expect(updateAssistantMessage).toHaveBeenCalledTimes(1)
    expect(updateAssistantMessage).toHaveBeenNthCalledWith(1, 'assistant-1', 'ab')

    firstUpdate.resolve()
    const result = await resultPromise

    expect(result.fullText).toBe('abc')
    const updatedContents = updateAssistantMessage.mock.calls.map(([, content]) => content)
    expect(updatedContents[0]).toBe('ab')
    expect(updatedContents[updatedContents.length - 1]).toBe('abc')
    expect(updatedContents.filter((content) => content === 'abc').length).toBeGreaterThanOrEqual(1)
    expect(deleteAssistantMessage).not.toHaveBeenCalled()
  })

  it('deletes inserted message and rethrows when update fails', async () => {
    const insertAssistantMessage = vi.fn(async () => 'assistant-1')
    const updateAssistantMessage = vi.fn(async () => {
      throw new Error('update failed')
    })
    const deleteAssistantMessage = vi.fn(async () => undefined)

    await expect(
      persistStreamedAssistantMessage({
        textStream: ['a', 'b'],
        updateIntervalMs: 0,
        now: () => 0,
        insertAssistantMessage,
        updateAssistantMessage,
        deleteAssistantMessage,
      }),
    ).rejects.toThrow('update failed')

    expect(deleteAssistantMessage).toHaveBeenCalledWith('assistant-1')
  })

  it('deletes inserted message and rethrows when stream fails', async () => {
    const insertAssistantMessage = vi.fn(async () => 'assistant-1')
    const updateAssistantMessage = vi.fn(async () => undefined)
    const deleteAssistantMessage = vi.fn(async () => undefined)

    async function* brokenStream() {
      yield 'first'
      throw new Error('stream exploded')
    }

    await expect(
      persistStreamedAssistantMessage({
        textStream: brokenStream(),
        updateIntervalMs: 0,
        now: () => 0,
        insertAssistantMessage,
        updateAssistantMessage,
        deleteAssistantMessage,
      }),
    ).rejects.toThrow('stream exploded')

    expect(deleteAssistantMessage).toHaveBeenCalledWith('assistant-1')
  })

  it('returns an empty result when the stream yields no chunks', async () => {
    const insertAssistantMessage = vi.fn(async () => 'assistant-1')
    const updateAssistantMessage = vi.fn(async () => undefined)
    const deleteAssistantMessage = vi.fn(async () => undefined)

    const result = await persistStreamedAssistantMessage({
      textStream: [],
      updateIntervalMs: 0,
      now: () => 0,
      insertAssistantMessage,
      updateAssistantMessage,
      deleteAssistantMessage,
    })

    expect(result).toEqual({
      fullText: '',
      assistantMessageId: null,
      messageInsertDuration: null,
    })
    expect(insertAssistantMessage).not.toHaveBeenCalled()
    expect(updateAssistantMessage).not.toHaveBeenCalled()
    expect(deleteAssistantMessage).not.toHaveBeenCalled()
  })

  it('normalizes non-Error update failures before rethrowing', async () => {
    const insertAssistantMessage = vi.fn(async () => 'assistant-1')
    const updateAssistantMessage = vi.fn(async () => {
      throw 'plain failure'
    })
    const deleteAssistantMessage = vi.fn(async () => undefined)

    await expect(
      persistStreamedAssistantMessage({
        textStream: ['a', 'b'],
        updateIntervalMs: 0,
        now: () => 0,
        insertAssistantMessage,
        updateAssistantMessage,
        deleteAssistantMessage,
      }),
    ).rejects.toThrow('plain failure')

    expect(deleteAssistantMessage).toHaveBeenCalledWith('assistant-1')
  })
})
