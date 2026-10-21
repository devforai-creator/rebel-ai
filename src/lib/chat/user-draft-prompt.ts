import { buildChatContextRequest } from '@/lib/chat-memory/prompt-context'
import type { MemoryPromptBlock } from '@/lib/chat-memory/types'

/** Adapt the shared prefix plan to labelled reference data without replaying NPC roles. */
export function buildUserDraftPrefixRequest({
  system,
  userPersona,
  characterAndSetting,
  alwaysActiveLore,
  conditionalLore,
  promptBlocks,
  instruction,
  cacheConditionalLore = false,
}: {
  system: string
  userPersona: { name: string; description: string | null } | null
  characterAndSetting: {
    name: string
    system_prompt: string
    post_history_instructions: string | null
  }
  alwaysActiveLore: string | null
  conditionalLore: string | null
  promptBlocks: MemoryPromptBlock[]
  instruction: string
  /** Only for per-request explicit cache preparation; automatic caching keeps lore live. */
  cacheConditionalLore?: boolean
}) {
  const draftTask = {
    writingInstruction: instruction || null,
    task: instruction
      ? 'Expand the writingInstruction into the next USER message.'
      : 'Suggest the next USER reaction to the current scene.',
  }
  const referenceRequest = buildChatContextRequest({
    context: {
      instructions: system,
      memory: null,
      turnContext: cacheConditionalLore
        ? conditionalLore
          ? JSON.stringify({ activeLore: conditionalLore })
          : null
        : JSON.stringify({ activeLore: conditionalLore, ...draftTask }),
    },
    messages: [
      {
        role: 'user',
        content: JSON.stringify({ userPersona, characterAndSetting, alwaysActiveLore }),
      },
      ...promptBlocks
        .filter((block) => block.stability !== 'static')
        .map((block) => ({
          role: 'user' as const,
          content: JSON.stringify(
            block.role === 'system'
              ? { memory: block.content }
              : { transcript: { role: block.role, content: block.content } },
          ),
        })),
    ],
  })
  if (!cacheConditionalLore) return referenceRequest

  // The Google adapter caches all but the final message. Keep current lore after
  // history for precedence, and leave only the draft instruction/task in that tail.
  return buildChatContextRequest({
    context: {
      instructions: system,
      memory: null,
      turnContext: JSON.stringify(draftTask),
    },
    messages: referenceRequest.messages,
  })
}
