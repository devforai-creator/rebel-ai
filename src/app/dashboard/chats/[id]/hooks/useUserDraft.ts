'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { readApiErrorMessage } from '@/lib/http/api-contract'
import {
  userDraftUsageSchema,
  type UserDraftRequest,
  type UserDraftUsage,
} from '@/lib/chat/user-draft-contract'

type UserDraftOptions = {
  chatId: string
  apiKeyId: string
  modelName: string
  provider?: string
  configurationError?: string | null
  reasoningEffort?: UserDraftRequest['reasoningEffort']
  serviceTier?: UserDraftRequest['serviceTier']
  contextKey: string
  input: string
  isChatLoading: boolean
  replaceInput: (value: string) => void
}

export function useUserDraft(options: UserDraftOptions) {
  const {
    chatId,
    apiKeyId,
    modelName,
    provider,
    configurationError,
    reasoningEffort,
    serviceTier,
    contextKey,
    input,
    isChatLoading,
    replaceInput,
  } = options
  const [isDrafting, setIsDrafting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usageResult, setUsageResult] = useState<{
    scopeKey: string
    usage: UserDraftUsage
  } | null>(null)
  const [previousInput, setPreviousInput] = useState<{
    chatId: string
    original: string
    generated: string
  } | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const activeRequestContext = useRef<{ scopeKey: string; input: string } | null>(null)
  const disabledReason =
    configurationError ??
    (provider === 'local'
      ? '대신 작성은 클라우드 모델에서만 사용할 수 있습니다.'
      : !provider || !apiKeyId || !modelName
        ? '먼저 클라우드 모델을 선택해주세요.'
        : isChatLoading
          ? '현재 응답이나 메시지 편집이 끝난 뒤 작성할 수 있습니다.'
          : null)
  const scopeKey = JSON.stringify([
    chatId,
    apiKeyId,
    modelName,
    provider,
    reasoningEffort,
    serviceTier,
    contextKey,
  ])
  const latest = useRef({ scopeKey, input, isChatLoading, disabledReason })
  latest.current = { scopeKey, input, isChatLoading, disabledReason }

  const cancelDraft = useCallback(() => {
    activeRequest.current?.abort()
    activeRequest.current = null
    setIsDrafting(false)
  }, [])

  // Editing, sending, switching models/chats, or receiving a new turn invalidates a pending draft.
  useEffect(() => {
    if (
      activeRequest.current &&
      (activeRequestContext.current?.scopeKey !== scopeKey ||
        activeRequestContext.current?.input !== input ||
        isChatLoading)
    ) {
      cancelDraft()
    }
    setError(null)
  }, [input, scopeKey, isChatLoading, cancelDraft])

  useEffect(() => () => activeRequest.current?.abort(), [])

  const generateDraft = useCallback(async () => {
    const snapshot = latest.current
    if (activeRequest.current || snapshot.disabledReason || snapshot.isChatLoading) return

    const controller = new AbortController()
    activeRequest.current = controller
    activeRequestContext.current = snapshot
    setIsDrafting(true)
    setError(null)
    setUsageResult(null)
    try {
      const body: UserDraftRequest = {
        apiKeyId,
        modelName,
        instruction: snapshot.input,
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
        ...(serviceTier !== undefined ? { serviceTier } : {}),
      }
      const response = await fetch('/api/chats/' + encodeURIComponent(chatId) + '/user-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '초안을 작성하지 못했습니다.'))
      }
      const result: unknown = await response.json()
      if (
        !result ||
        typeof result !== 'object' ||
        !('content' in result) ||
        typeof result.content !== 'string' ||
        !result.content.trim()
      ) {
        throw new Error('완성된 초안을 받지 못했습니다. 다시 시도해주세요.')
      }
      if (
        controller.signal.aborted ||
        activeRequest.current !== controller ||
        latest.current.scopeKey !== snapshot.scopeKey ||
        latest.current.input !== snapshot.input ||
        latest.current.isChatLoading
      )
        return

      const content = result.content.trim()
      const usage = userDraftUsageSchema.safeParse('usage' in result ? result.usage : undefined)
      setUsageResult(usage.success ? { scopeKey: snapshot.scopeKey, usage: usage.data } : null)
      setPreviousInput({ chatId, original: snapshot.input, generated: content })
      replaceInput(content)
    } catch (cause) {
      if (!controller.signal.aborted && activeRequest.current === controller) {
        setError(cause instanceof Error ? cause.message : '초안을 작성하지 못했습니다.')
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setIsDrafting(false)
      }
    }
  }, [apiKeyId, modelName, chatId, reasoningEffort, serviceTier, replaceInput])

  const canRestore = previousInput?.chatId === chatId && previousInput.generated === input
  const restoreInput = useCallback(() => {
    if (!previousInput || previousInput.chatId !== chatId || previousInput.generated !== input)
      return
    cancelDraft()
    replaceInput(previousInput.original)
    setPreviousInput(null)
    setError(null)
  }, [previousInput, chatId, input, cancelDraft, replaceInput])

  return {
    isDrafting,
    error,
    usage: usageResult?.scopeKey === scopeKey ? usageResult.usage : null,
    disabledReason,
    generateDraft,
    cancelDraft,
    canRestore,
    restoreInput,
  }
}
