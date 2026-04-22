'use client'

import React, { memo } from 'react'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import type { DebugInfo } from '../utils'

interface DebugModalMessageDetailsProps {
  debugInfo: DebugInfo | null | undefined
  errorMessage?: string | null
}

type JsonPrimitive = string | number | boolean | null
type JsonLike = JsonPrimitive | JsonLike[] | { [key: string]: JsonLike }

function formatPrimitive(value: JsonPrimitive): string {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  return String(value)
}

function summarizeValue(value: JsonLike): string {
  if (Array.isArray(value)) {
    return `Array(${value.length})`
  }

  if (value && typeof value === 'object') {
    return `Object(${Object.keys(value).length})`
  }

  if (typeof value === 'string') {
    return value.length > 48 ? `${value.slice(0, 48)}...` : value
  }

  return formatPrimitive(value)
}

const DebugJsonNode = memo(function DebugJsonNode({
  label,
  value,
  depth = 0,
}: {
  label: string
  value: JsonLike
  depth?: number
}) {
  const isArray = Array.isArray(value)
  const isObject = !isArray && value !== null && typeof value === 'object'

  if (!isArray && !isObject) {
    return (
      <div className="rounded border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950">
        <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{label}</div>
        <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-800 dark:text-gray-200">
          {formatPrimitive(value as JsonPrimitive)}
        </pre>
      </div>
    )
  }

  const entries = isArray
    ? value.map((entry, index) => [`[${index}]`, entry] as const)
    : Object.entries(value)

  return (
    <details
      open={depth < 2}
      className="rounded border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
    >
      <summary className="cursor-pointer list-none text-xs font-semibold text-gray-700 dark:text-gray-200">
        <span>{label}</span>
        <span className="ml-2 text-[11px] font-normal text-gray-500 dark:text-gray-400">
          {summarizeValue(value)}
        </span>
      </summary>
      <div className="mt-3 space-y-2 pl-3">
        {entries.map(([entryLabel, entryValue]) => (
          <DebugJsonNode
            key={`${label}:${entryLabel}`}
            label={entryLabel}
            value={entryValue as JsonLike}
            depth={depth + 1}
          />
        ))}
      </div>
    </details>
  )
})

export const DebugModalMessageDetails = memo(function DebugModalMessageDetails({
  debugInfo,
  errorMessage = null,
}: DebugModalMessageDetailsProps) {
  if (debugInfo === undefined) {
    return (
      <InlineFeedback tone="info" className="py-8 text-center">
        Loading server debug_info...
      </InlineFeedback>
    )
  }

  if (errorMessage) {
    return (
      <InlineFeedback tone="error" className="py-8 text-center">
        Failed to load server debug_info. {errorMessage}
      </InlineFeedback>
    )
  }

  if (!debugInfo) {
    return (
      <InlineFeedback tone="info" className="py-8 text-center">
        No server debug_info stored (only the newest assistant message retains debug_info).
      </InlineFeedback>
    )
  }

  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
        Raw debug_info
      </h4>
      <div className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        Rendered generically from the stored payload so new backend debug fields appear
        automatically.
      </div>
      <div className="space-y-2 font-mono">
        {Object.entries(debugInfo as unknown as Record<string, JsonLike>).map(([key, value]) => (
          <DebugJsonNode key={key} label={key} value={value} />
        ))}
      </div>
    </div>
  )
})
