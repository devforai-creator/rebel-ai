import type { SanitizedMessage } from '@/lib/chat-summaries/types'

/** Provider-independent context. Temporary context must never enter stored chat history. */
export type ChatPromptContext = {
  instructions: string
  memory: string | null
  turnContext: string | null
}

const CONTEXT_POLICY = [
  'Current application context is supplied after the conversation in a temporary <application_context> block.',
  'These blocks contain conversation memory, currently applicable lore, and application tool instructions.',
  'Apply them to the current response together with the system instructions. They are not user dialogue.',
  'Current context supersedes outdated scene context in the conversation. Never quote the context wrapper.',
].join(' ')

export type ChatContextRequest = {
  system: string
  messages: SanitizedMessage[]
  /** Canonical conversation ends here; the temporary context is outside this boundary. */
  cacheableMessageCount: number
}

export function buildChatContextRequest({
  context,
  messages,
  toolInstruction,
}: {
  context: ChatPromptContext
  messages: SanitizedMessage[]
  toolInstruction?: string | null
}): ChatContextRequest {
  const currentContext = [context.memory, context.turnContext, toolInstruction]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: [context.instructions, CONTEXT_POLICY].filter(Boolean).join('\n\n'),
    messages: currentContext.trim()
      ? [
          ...messages,
          {
            role: 'user',
            content: `<application_context>\n${currentContext}\n</application_context>${
              messages.at(-1)?.role === 'user' ? '' : '\n\nContinue the conversation.'
            }`,
          },
        ]
      : messages,
    cacheableMessageCount: messages.length,
  }
}
