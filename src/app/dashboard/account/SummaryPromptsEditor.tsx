'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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

  const handleSave = async () => {
    setIsLoading(true)

    const result = await updateSummaryPrompts(
      chunkPrompt === DEFAULT_CHUNK_SUMMARY_PROMPT ? null : chunkPrompt,
      metaPrompt === DEFAULT_META_SUMMARY_PROMPT ? null : metaPrompt,
      factPrompt === DEFAULT_FACT_EXTRACTION_PROMPT ? null : factPrompt,
    )

    setIsLoading(false)

    if (result.error) {
      alert('Save failed: ' + result.error)
    } else {
      alert('Saved successfully!')
      router.refresh()
    }
  }

  const handleReset = () => {
    if (confirm('Reset to defaults? Unsaved changes will be lost.')) {
      setChunkPrompt(DEFAULT_CHUNK_SUMMARY_PROMPT)
      setMetaPrompt(DEFAULT_META_SUMMARY_PROMPT)
      setFactPrompt(DEFAULT_FACT_EXTRACTION_PROMPT)
    }
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
        <button
          onClick={handleSave}
          disabled={isLoading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={handleReset}
          disabled={isLoading}
          className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  )
}
