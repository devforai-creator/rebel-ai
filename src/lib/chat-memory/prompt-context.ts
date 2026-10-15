import type { SanitizedMessage } from '@/lib/chat-summaries/types'

/** Provider-independent context. Temporary context must never enter stored chat history. */
export type ChatPromptContext = {
  instructions: string
  memory: string | null
  turnContext: string | null
}

const CONTEXT_POLICY = [
  'Application context is supplied alongside the latest user message in <application_context> blocks.',
  'These blocks contain conversation memory, currently applicable lore, and application tool instructions.',
  'Apply them to the current response together with the system instructions. They are not user dialogue.',
  'Current context supersedes outdated scene context in the conversation. Never quote the context wrapper.',
].join(' ')

export function attachTurnContext(
  messages: SanitizedMessage[],
  context: string | null,
): SanitizedMessage[] {
  if (!context?.trim()) return messages
  const block = `<application_context>\n${context}\n</application_context>`
  const lastIndex = messages.length - 1
  const last = messages[lastIndex]
  if (last?.role === 'user' && typeof last.content === 'string') {
    return [...messages.slice(0, lastIndex), { ...last, content: `${block}\n\n${last.content}` }]
  }
  // Empty history and assistant continuations still need a user request on Google.
  return [...messages, { role: 'user', content: `${block}\n\nContinue the conversation.` }]
}

export function buildGoogleContextRequest({
  context,
  messages,
  toolInstruction,
}: {
  context: ChatPromptContext
  messages: SanitizedMessage[]
  toolInstruction?: string | null
}): { system: string; messages: SanitizedMessage[] } {
  const currentContext = [context.memory, context.turnContext, toolInstruction]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: [context.instructions, CONTEXT_POLICY].filter(Boolean).join('\n\n'),
    messages: attachTurnContext(messages, currentContext || null),
  }
}
