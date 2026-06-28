'use client'

import React from 'react'
import { useState, type ReactNode } from 'react'
import Button from '@/app/dashboard/components/Button'
import { surfaceCardClassName } from '@/app/dashboard/components/SurfaceCard'
import type { FactEntry, SummaryEntry } from '../hooks/useChatSummariesState'
import type { SummaryPromptStatus, SummaryStructure } from '../summary-structure'

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
  countDetail?: string | null
  collapsed: boolean
  onToggle: () => void
  description?: ReactNode
  className?: string
  children: ReactNode
}

function CollapsibleMemorySection({
  title,
  count,
  countDetail,
  collapsed,
  onToggle,
  description,
  className,
  children,
}: CollapsibleMemorySectionProps) {
  return (
    <section className={className ?? 'mt-6 space-y-4'}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between text-sm font-semibold text-gray-800 transition-colors hover:text-gray-600 dark:text-gray-200 dark:hover:text-gray-400"
      >
        <span>
          {title} ({count}
          {countDetail ? ` · ${countDetail}` : ''})
        </span>
        <span className="text-lg" aria-hidden="true">
          {collapsed ? '▶' : '▼'}
        </span>
      </button>
      {!collapsed && description ? (
        <div className="mb-3 space-y-2 text-xs text-gray-600 dark:text-gray-400">{description}</div>
      ) : null}
      {!collapsed ? children : null}
    </section>
  )
}

type SummaryMemoryInteractionProps = {
  editingSummaryId: string | null
  summaryEditContent: string
  onChangeSummaryEditContent: (value: string) => void
  regeneratingSummaryId: string | null
  onStartEdit: (summaryId: string, currentSummary: string) => void
  onSaveEdit: (summaryId: string) => void
  onCancelEdit: () => void
  onRegenerate: (summaryId: string) => void
  onDelete: (summaryId: string) => void
  promptStatuses?: Readonly<Record<string, SummaryPromptStatus>>
}

type SummaryMemoryCardProps = SummaryMemoryInteractionProps & {
  summary: SummaryEntry
  cardClassName: string
  regenerateButtonClassName: string
  editorRows: number
}

const DEFAULT_SUMMARY_CARD_CLASS_NAME = surfaceCardClassName({
  className: 'dark:bg-gray-900',
})

const SUMMARY_REGENERATE_BUTTON_CLASS_NAME =
  'text-purple-600 hover:text-purple-700 dark:text-purple-300 disabled:opacity-50'

function SummaryMemoryCard({
  summary,
  cardClassName,
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
  promptStatuses,
}: SummaryMemoryCardProps) {
  const formattedTimestamp = formatTimestamp(summary.created_at)
  const isEditing = editingSummaryId === summary.id

  return (
    <article className={cardClassName}>
      <div className="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span>
            {LEVEL_LABEL[summary.level] ?? 'Summary'} · {`${summary.start_seq}-${summary.end_seq}`}
            {formattedTimestamp ? ` · ${formattedTimestamp}` : null}
          </span>
          {summary.summary_status === 'fallback' ? (
            <span
              className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
              title="Local fallback summary"
            >
              Fallback
            </span>
          ) : null}
          {promptStatuses?.[summary.id] === 'in_prompt' ? (
            <span
              className="rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 font-medium text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200"
              title="Included in the current prompt"
            >
              In prompt
            </span>
          ) : null}
        </div>
        {!isEditing ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onStartEdit(summary.id, summary.summary)}
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
              title="Edit"
            >
              ✏️
            </button>
            <button
              type="button"
              onClick={() => onRegenerate(summary.id)}
              disabled={regeneratingSummaryId === summary.id}
              className={regenerateButtonClassName}
              title="Regenerate summary"
            >
              {regeneratingSummaryId === summary.id ? '⟳' : '♻️'}
            </button>
            <button
              type="button"
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
            <Button onClick={() => onSaveEdit(summary.id)} size="sm">
              Save
            </Button>
            <Button onClick={onCancelEdit} variant="secondary" size="sm">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-line text-sm leading-5 text-gray-800 dark:text-gray-200">
          {summary.summary}
        </p>
      )}
    </article>
  )
}

type SummaryMemoryTreeSectionProps = SummaryMemoryInteractionProps & {
  structure: SummaryStructure
  collapsed: boolean
  onToggle: () => void
}

export function SummaryMemoryTreeSection({
  structure,
  collapsed,
  onToggle,
  ...interactionProps
}: SummaryMemoryTreeSectionProps) {
  const [expandedMetaIds, setExpandedMetaIds] = useState<Set<string>>(() => new Set())
  const structuredSummaries = structure.metaNodes.flatMap((node) => [
    node.summary,
    ...node.children,
  ])
  const allSummaries = [...structuredSummaries, ...structure.looseChunks]

  if (allSummaries.length === 0) {
    return null
  }

  const fallbackCount = allSummaries.filter(
    (summary) => summary.summary_status === 'fallback',
  ).length

  function toggleMetaChildren(summaryId: string) {
    setExpandedMetaIds((current) => {
      const next = new Set(current)
      if (next.has(summaryId)) {
        next.delete(summaryId)
      } else {
        next.add(summaryId)
      }
      return next
    })
  }

  return (
    <CollapsibleMemorySection
      title="Summary Structure"
      count={allSummaries.length}
      countDetail={
        fallbackCount > 0 ? `${fallbackCount} fallback${fallbackCount === 1 ? '' : 's'}` : null
      }
      collapsed={collapsed}
      onToggle={onToggle}
      className="mt-6 space-y-4"
    >
      <ul className="space-y-5">
        {structure.metaNodes.map((node) => {
          const childrenExpanded = expandedMetaIds.has(node.summary.id)
          const childContainerId = `summary-children-${node.summary.id}`

          return (
            <li key={node.summary.id} className="space-y-3">
              <SummaryMemoryCard
                summary={node.summary}
                cardClassName={DEFAULT_SUMMARY_CARD_CLASS_NAME}
                regenerateButtonClassName={SUMMARY_REGENERATE_BUTTON_CLASS_NAME}
                editorRows={5}
                {...interactionProps}
              />
              {node.children.length > 0 ? (
                <div className="ml-3 border-l border-gray-200 pl-3 dark:border-gray-700">
                  <button
                    type="button"
                    onClick={() => toggleMetaChildren(node.summary.id)}
                    aria-expanded={childrenExpanded}
                    aria-controls={childContainerId}
                    className="flex w-full items-center justify-between py-1 text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  >
                    <span>Chunk Summaries ({node.children.length})</span>
                    <span aria-hidden="true">{childrenExpanded ? '▼' : '▶'}</span>
                  </button>
                  {childrenExpanded ? (
                    <ul id={childContainerId} className="mt-2 space-y-3">
                      {node.children.map((child) => (
                        <li key={child.id}>
                          <SummaryMemoryCard
                            summary={child}
                            cardClassName={DEFAULT_SUMMARY_CARD_CLASS_NAME}
                            regenerateButtonClassName={SUMMARY_REGENERATE_BUTTON_CLASS_NAME}
                            editorRows={4}
                            {...interactionProps}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {structure.looseChunks.length > 0 ? (
        <section className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Loose Chunks ({structure.looseChunks.length})
          </h3>
          <ul className="space-y-3">
            {structure.looseChunks.map((chunk) => (
              <li key={chunk.id}>
                <SummaryMemoryCard
                  summary={chunk}
                  cardClassName={DEFAULT_SUMMARY_CARD_CLASS_NAME}
                  regenerateButtonClassName={SUMMARY_REGENERATE_BUTTON_CLASS_NAME}
                  editorRows={4}
                  {...interactionProps}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
              className={surfaceCardClassName({
                className: 'dark:bg-gray-900',
              })}
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
                    <Button onClick={() => onSaveEdit(fact.id)} size="sm">
                      Save
                    </Button>
                    <Button onClick={onCancelEdit} variant="secondary" size="sm">
                      Cancel
                    </Button>
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
