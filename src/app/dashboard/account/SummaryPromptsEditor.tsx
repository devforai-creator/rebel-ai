'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/app/dashboard/components/Button'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import { runConfirmedAction } from '@/app/dashboard/components/confirm-action'
import { updateSummaryPrompts } from './actions'
import {
  DEFAULT_CHUNK_SUMMARY_PROMPT,
  DEFAULT_META_SUMMARY_PROMPT,
  DEFAULT_FACT_EXTRACTION_PROMPT,
} from '@/lib/chat-summaries/config'

interface Props {
  initialChunkPrompt: string | null
  initialMetaPrompt: string | null
  initialFactPrompt: string | null
}

export default function SummaryPromptsEditor({
  initialChunkPrompt,
  initialMetaPrompt,
  initialFactPrompt,
}: Props) {
  const router = useRouter()
  const [chunkPrompt, setChunkPrompt] = useState(initialChunkPrompt || DEFAULT_CHUNK_SUMMARY_PROMPT)
  const [metaPrompt, setMetaPrompt] = useState(initialMetaPrompt || DEFAULT_META_SUMMARY_PROMPT)
  const [factPrompt, setFactPrompt] = useState(initialFactPrompt || DEFAULT_FACT_EXTRACTION_PROMPT)
  const [isLoading, setIsLoading] = useState(false)
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)

  const handleSave = async () => {
    setIsLoading(true)

    const result = await updateSummaryPrompts(
      chunkPrompt === DEFAULT_CHUNK_SUMMARY_PROMPT ? null : chunkPrompt,
      metaPrompt === DEFAULT_META_SUMMARY_PROMPT ? null : metaPrompt,
      factPrompt === DEFAULT_FACT_EXTRACTION_PROMPT ? null : factPrompt,
    )

    setIsLoading(false)

    if (result.error) {
      toast.error('Save failed: ' + result.error)
    } else {
      toast.success('Saved successfully.')
      router.refresh()
    }
  }

  const handleReset = () => {
    setIsResetConfirmOpen(true)
  }

  const confirmReset = async () => {
    const shouldReset = isResetConfirmOpen
    setIsResetConfirmOpen(false)

    await runConfirmedAction(shouldReset ? true : null, async () => {
      setChunkPrompt(DEFAULT_CHUNK_SUMMARY_PROMPT)
      setMetaPrompt(DEFAULT_META_SUMMARY_PROMPT)
      setFactPrompt(DEFAULT_FACT_EXTRACTION_PROMPT)
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <label
          htmlFor="chunk-prompt"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Chunk Summary Prompt (per 10 messages)
        </label>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          System prompt used when summarizing conversations in chunks of 10 messages.
        </p>
        <textarea
          id="chunk-prompt"
          value={chunkPrompt}
          onChange={(e) => setChunkPrompt(e.target.value)}
          rows={4}
          className="mt-2 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
      </div>

      <div>
        <label
          htmlFor="meta-prompt"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Meta Summary Prompt (per 100 messages)
        </label>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          System prompt used when combining 10 chunk summaries into a higher-level summary.
        </p>
        <textarea
          id="meta-prompt"
          value={metaPrompt}
          onChange={(e) => setMetaPrompt(e.target.value)}
          rows={4}
          className="mt-2 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
      </div>

      <div>
        <label
          htmlFor="fact-prompt"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Fact Extraction Prompt (Episodic Memory, per 10 messages)
        </label>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          System prompt used when extracting specific facts (dates, places, food, appointments,
          etc.) from conversations. Unlike summaries, this preserves details exactly.
        </p>
        <textarea
          id="fact-prompt"
          value={factPrompt}
          onChange={(e) => setFactPrompt(e.target.value)}
          rows={6}
          className="mt-2 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
      </div>

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={isLoading}>
          {isLoading ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={handleReset} disabled={isLoading} variant="secondary">
          Reset to Defaults
        </Button>
      </div>

      <ConfirmDialog
        isOpen={isResetConfirmOpen}
        title="Reset prompts to defaults?"
        description="Unsaved prompt edits will be discarded."
        confirmLabel="Reset prompts"
        tone="primary"
        onConfirm={() => void confirmReset()}
        onClose={() => setIsResetConfirmOpen(false)}
      />
    </div>
  )
}
