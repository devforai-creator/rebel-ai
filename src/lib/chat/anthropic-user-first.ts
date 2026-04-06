export type AnthropicConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Anthropic conversations must start with a user message.
 * If the first entry is assistant-authored, prepend a minimal placeholder.
 */
export function ensureUserFirstForAnthropic(messages: AnthropicConversationMessage[]): {
  messages: AnthropicConversationMessage[]
  placeholderAdded: boolean
} {
  if (messages.length === 0) {
    return { messages, placeholderAdded: false }
  }

  if (messages[0].role === 'assistant') {
    return {
      messages: [{ role: 'user', content: '(continue)' }, ...messages],
      placeholderAdded: true,
    }
  }

  return { messages, placeholderAdded: false }
}
