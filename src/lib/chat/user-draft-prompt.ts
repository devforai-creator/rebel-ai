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
}) {
  return buildChatContextRequest({
    context: {
      instructions: system,
      memory: null,
      turnContext: JSON.stringify({
        activeLore: conditionalLore,
        writingInstruction: instruction || null,
        task: instruction
          ? 'Expand the writingInstruction into the next USER message.'
          : 'Suggest the next USER reaction to the current scene.',
      }),
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
}
