'use client'

import React from 'react'
import type { ReactNode } from 'react'
import type { FactEntry, SummaryEntry } from '../hooks/useChatSummariesState'

const LEVEL_LABEL: Record<number, string> = {
  2: 'Super Meta Summary',
  1: 'Meta Summary',
  0: 'Chunk Summary',
}

function formatTimestamp(value: string | null): string | null {
  if (!value) {
    return null
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

type CollapsibleMemorySectionProps = {
  title: string
  count: number
  collapsed: boolean
  onToggle: () => void
  description?: ReactNode
  className?: string
  children: ReactNode
}

function CollapsibleMemorySection({
  title,
  count,
  collapsed,
  onToggle,
  description,
  className,
  children,
}: CollapsibleMemorySectionProps) {
  return (
    <section className={className ?? 'mt-6 space-y-4'}>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between text-sm font-semibold text-gray-800 transition-colors hover:text-gray-600 dark:text-gray-200 dark:hover:text-gray-400"
      >
        <span>
          {title} ({count})
        </span>
        <span className="text-lg">{collapsed ? '▶' : '▼'}</span>
      </button>
      {!collapsed && description ? (
        <div className="mb-3 space-y-2 text-xs text-gray-600 dark:text-gray-400">{description}</div>
      ) : null}
      {!collapsed ? children : null}
    </section>
  )
}

type SummaryMemorySectionProps = {
  title: string
  summaries: SummaryEntry[]
  collapsed: boolean
  onToggle: () => void
  description?: ReactNode
  className?: string
  listClassName?: string
  cardClassName?: string
  regenerateButtonClassName: string
  editorRows: number
  editingSummaryId: string | null
  summaryEditContent: string
  onChangeSummaryEditContent: (value: string) => void
  regeneratingSummaryId: string | null
  onStartEdit: (summaryId: string, currentSummary: string) => void
  onSaveEdit: (summaryId: string) => void
  onCancelEdit: () => void
  onRegenerate: (summaryId: string) => void
  onDelete: (summaryId: string) => void
}

export function SummaryMemorySection({
  title,
  summaries,
  collapsed,
  onToggle,
  description,
  className,
  listClassName = 'space-y-3',
  cardClassName = 'rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900',
  regenerateButtonClassName,
  editorRows,
  editingSummaryId,
  summaryEditContent,
  onChangeSummaryEditContent,
  regeneratingSummaryId,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRegenerate,
  onDelete,
}: SummaryMemorySectionProps) {
  if (summaries.length === 0) {
    return null
  }

  return (
    <CollapsibleMemorySection
      title={title}
      count={summaries.length}
      collapsed={collapsed}
      onToggle={onToggle}
      description={description}
      className={className}
    >
      <ul className={listClassName}>
        {summaries.map((summary) => {
          const formattedTimestamp = formatTimestamp(summary.created_at)
          const isEditing = editingSummaryId === summary.id

          return (
            <li key={summary.id} className={cardClassName}>
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <div>
                  {LEVEL_LABEL[summary.level] ?? 'Summary'} · {summary.start_seq}-{summary.end_seq}
                  {formattedTimestamp ? ` · ${formattedTimestamp}` : null}
                </div>
                {!isEditing ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => onStartEdit(summary.id, summary.summary)}
                      className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => onRegenerate(summary.id)}
                      disabled={regeneratingSummaryId === summary.id}
                      className={regenerateButtonClassName}
                      title="Regenerate summary"
                    >
                      {regeneratingSummaryId === summary.id ? '⟳' : '♻️'}
                    </button>
                    <button
                      onClick={() => onDelete(summary.id)}
                      className="text-red-600 hover:text-red-700 dark:text-red-400"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                ) : null}
              </div>

              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={summaryEditContent}
                    onChange={(event) => onChangeSummaryEditContent(event.target.value)}
                    className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                    rows={editorRows}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => onSaveEdit(summary.id)}
                      className="rounded bg-blue-600 px-3 py-1 text-xs text-white transition-colors hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={onCancelEdit}
                      className="rounded bg-gray-500 px-3 py-1 text-xs text-white transition-colors hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-line text-sm leading-5 text-gray-800 dark:text-gray-200">
                  {summary.summary}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </CollapsibleMemorySection>
  )
}

type FactMemorySectionProps = {
  facts: FactEntry[]
  collapsed: boolean
  onToggle: () => void
  editingFactId: string | null
  factEditContent: string
  onChangeFactEditContent: (value: string) => void
  regeneratingFactId: string | null
  reembeddingFactId: string | null
  onStartEdit: (factId: string, currentFacts: string) => void
  onSaveEdit: (factId: string) => void
  onCancelEdit: () => void
  onRegenerate: (factId: string) => void
  onReembed: (factId: string) => void
}

export function FactMemorySection({
  facts,
  collapsed,
  onToggle,
  editingFactId,
  factEditContent,
  onChangeFactEditContent,
  regeneratingFactId,
  reembeddingFactId,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRegenerate,
  onReembed,
}: FactMemorySectionProps) {
  if (facts.length === 0) {
    return null
  }

  return (
    <CollapsibleMemorySection
      title="Episodic Memory"
      count={facts.length}
      collapsed={collapsed}
      onToggle={onToggle}
      className="mt-8 space-y-4"
      description={
        <p>
          Specific facts extracted from conversations. Details like dates, places, food,
          appointments are preserved.
        </p>
      }
    >
      <ul className="space-y-3">
        {facts.map((fact) => {
          const formattedTimestamp = formatTimestamp(fact.created_at)
          const isEditing = editingFactId === fact.id

          return (
            <li
              key={fact.id}
              className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
            >
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <div>
                  Messages {fact.start_seq}-{fact.end_seq}
                  {formattedTimestamp ? ` · ${formattedTimestamp}` : null}
                </div>
                {!isEditing ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => onStartEdit(fact.id, fact.facts)}
                      className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => onRegenerate(fact.id)}
                      disabled={regeneratingFactId === fact.id}
                      className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-300 disabled:opacity-50"
                      title="Regenerate episodic memory"
                    >
                      {regeneratingFactId === fact.id ? '⟳' : '♻️'}
                    </button>
                    <button
                      onClick={() => onReembed(fact.id)}
                      disabled={reembeddingFactId === fact.id}
                      className="text-purple-600 hover:text-purple-700 dark:text-purple-300 disabled:opacity-50"
                      title="Regenerate embedding"
                    >
                      {reembeddingFactId === fact.id ? '⟳' : '🔄'}
                    </button>
                  </div>
                ) : null}
              </div>
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={factEditContent}
                    onChange={(event) => onChangeFactEditContent(event.target.value)}
                    className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                    rows={4}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => onSaveEdit(fact.id)}
                      className="rounded bg-blue-600 px-3 py-1 text-xs text-white transition-colors hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={onCancelEdit}
                      className="rounded bg-gray-500 px-3 py-1 text-xs text-white transition-colors hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="whitespace-pre-line text-sm leading-5 text-gray-800 dark:text-gray-200">
                  {fact.facts}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </CollapsibleMemorySection>
  )
}
