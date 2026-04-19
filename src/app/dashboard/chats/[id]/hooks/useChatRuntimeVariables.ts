'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createApiError } from '@/lib/http/api-contract'
import type {
  ChatAssetData,
  ChatCharacterAsset,
  ModuleAssetSummary,
  ModuleRegexEntry,
} from '../utils'

export const EMPTY_ASSET_DATA: ChatAssetData = {
  characterAssets: [],
  assetUrlMap: {},
  imageCommandUrlMap: {},
  moduleRegex: [],
  moduleAssetSummary: [],
  globalVariables: {},
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectStringEntries(value: Record<string, unknown>): Record<string, string> {
  return Object.entries(value).reduce<Record<string, string>>((result, [key, entryValue]) => {
    if (typeof entryValue === 'string') {
      result[key] = entryValue
    }

    return result
  }, {})
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {}
  }

  return collectStringEntries(value)
}

function normalizeUnknownRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function normalizeCharacterAsset(value: unknown): ChatCharacterAsset | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.file_name !== 'string' ||
    typeof value.storage_path !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    file_name: value.file_name,
    storage_path: value.storage_path,
    display_name: typeof value.display_name === 'string' ? value.display_name : null,
    canonical_name: typeof value.canonical_name === 'string' ? value.canonical_name : null,
    display_order: typeof value.display_order === 'number' ? value.display_order : null,
    metadata: isRecord(value.metadata) ? value.metadata : null,
  }
}

function normalizeModuleRegexEntry(value: unknown): ModuleRegexEntry | null {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    typeof value.comment !== 'string' ||
    typeof value.in !== 'string' ||
    typeof value.out !== 'string'
  ) {
    return null
  }

  return {
    type: value.type,
    comment: value.comment,
    in: value.in,
    out: value.out,
    ableFlag: value.ableFlag === true,
    ...(isRecord(value.bindings)
      ? {
          bindings: collectStringEntries(value.bindings),
        }
      : {}),
    ...(typeof value.card_ref === 'string' ? { card_ref: value.card_ref } : {}),
  }
}

function normalizeModuleAssetSummary(value: unknown): ModuleAssetSummary | null {
  if (
    !isRecord(value) ||
    typeof value.moduleId !== 'string' ||
    typeof value.assetCount !== 'number' ||
    typeof value.expectedAssetCount !== 'number'
  ) {
    return null
  }

  return {
    moduleId: value.moduleId,
    moduleName: typeof value.moduleName === 'string' ? value.moduleName : null,
    assetCount: value.assetCount,
    expectedAssetCount: value.expectedAssetCount,
  }
}

export function normalizeChatAssetData(value: unknown): ChatAssetData {
  if (!isRecord(value)) {
    return EMPTY_ASSET_DATA
  }

  return {
    characterAssets: Array.isArray(value.characterAssets)
      ? value.characterAssets.flatMap((asset) => {
          const normalized = normalizeCharacterAsset(asset)
          return normalized ? [normalized] : []
        })
      : [],
    assetUrlMap: normalizeStringMap(value.assetUrlMap),
    imageCommandUrlMap: normalizeStringMap(value.imageCommandUrlMap),
    moduleRegex: Array.isArray(value.moduleRegex)
      ? value.moduleRegex.flatMap((entry) => {
          const normalized = normalizeModuleRegexEntry(entry)
          return normalized ? [normalized] : []
        })
      : [],
    moduleAssetSummary: Array.isArray(value.moduleAssetSummary)
      ? value.moduleAssetSummary.flatMap((entry) => {
          const normalized = normalizeModuleAssetSummary(entry)
          return normalized ? [normalized] : []
        })
      : [],
    globalVariables: normalizeUnknownRecord(value.globalVariables),
  }
}

export function resolveNextRuntimeVariables(
  currentVariables: Record<string, unknown>,
  type: string,
  actionId: string,
  payload?: unknown,
): Record<string, unknown> {
  if (actionId.trim().length === 0) {
    return currentVariables
  }

  if (type === 'toggle' && isRecord(payload) && typeof payload.value === 'boolean') {
    return {
      ...currentVariables,
      [actionId]: payload.value,
    }
  }

  return {
    ...currentVariables,
    [actionId]: true,
  }
}

export function useChatRuntimeVariables(chatId: string) {
  const [assetData, setAssetData] = useState<ChatAssetData>(EMPTY_ASSET_DATA)
  const [runtimeVariables, setRuntimeVariables] = useState<Record<string, unknown>>({})
  const runtimeVariablesRef = useRef<Record<string, unknown>>({})

  useEffect(() => {
    runtimeVariablesRef.current = runtimeVariables
  }, [runtimeVariables])

  useEffect(() => {
    let cancelled = false

    const loadAssets = async () => {
      try {
        const response = await fetch(`/api/chats/${chatId}/assets`, { cache: 'no-store' })
        if (!response.ok) {
          console.error('[ChatInterface] Failed to load assets:', response.status)
          return
        }

        const nextAssetData = normalizeChatAssetData(await response.json())
        if (cancelled) {
          return
        }

        runtimeVariablesRef.current = nextAssetData.globalVariables ?? {}
        setAssetData(nextAssetData)
        setRuntimeVariables(nextAssetData.globalVariables ?? {})
      } catch (error) {
        console.error('[ChatInterface] Error loading assets:', error)
      }
    }

    void loadAssets()
    return () => {
      cancelled = true
    }
  }, [chatId])

  const persistRuntimeVariables = useCallback(
    async (nextVariables: Record<string, unknown>) => {
      const sanitized = Object.fromEntries(
        Object.entries(nextVariables).filter(([, value]) => typeof value !== 'undefined'),
      )

      try {
        const response = await fetch(`/api/chats/${chatId}/variables`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: sanitized }),
        })

        if (!response.ok) {
          throw await createApiError(response, 'Failed to save variables')
        }
      } catch (error) {
        console.error('[TriggerClick] Failed to persist variables', error)
        toast.error('변수 저장 실패')
      }
    },
    [chatId],
  )

  const handleUiCardAction = useCallback(
    (type: string, actionId: string, payload?: unknown) => {
      const nextVariables = resolveNextRuntimeVariables(
        runtimeVariablesRef.current,
        type,
        actionId,
        payload,
      )

      runtimeVariablesRef.current = nextVariables
      setRuntimeVariables(nextVariables)
      void persistRuntimeVariables(nextVariables)
    },
    [persistRuntimeVariables],
  )

  return {
    assetData,
    runtimeVariables,
    handleUiCardAction,
  }
}
