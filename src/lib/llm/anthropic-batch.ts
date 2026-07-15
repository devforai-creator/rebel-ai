const ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'

export type AnthropicTextBlock = {
  type: 'text'
  text: string
  cache_control?: {
    type: 'ephemeral'
    ttl?: '5m' | '1h'
  }
}

export type AnthropicBatchMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AnthropicBatchMessageParams = {
  model: string
  max_tokens: number
  system?: string | AnthropicTextBlock[]
  messages: AnthropicBatchMessage[]
  thinking?: {
    type: 'adaptive' | 'disabled'
  }
  output_config?: {
    effort: 'low' | 'medium' | 'high' | 'max'
  }
  cache_control?: {
    type: 'ephemeral'
    ttl?: '5m' | '1h'
  }
}

export type AnthropicMessageBatch = {
  id: string
  type: 'message_batch'
  processing_status: 'in_progress' | 'canceling' | 'ended' | string
  request_counts?: {
    processing?: number
    succeeded?: number
    errored?: number
    canceled?: number
    expired?: number
  }
  ended_at: string | null
  created_at: string
  expires_at: string
  cancel_initiated_at: string | null
  results_url: string | null
}

export type AnthropicBatchResult =
  | {
      custom_id: string
      result: {
        type: 'succeeded'
        message: AnthropicBatchMessageResult
      }
    }
  | {
      custom_id: string
      result: {
        type: 'errored' | 'canceled' | 'expired'
        error?: {
          type?: string
          message?: string
        }
      }
    }

export type AnthropicBatchMessageResult = {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: Array<{ type: string; text?: string }>
  stop_reason: string | null
  stop_sequence: string | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

export async function createAnthropicMessageBatch({
  apiKey,
  customId,
  params,
}: {
  apiKey: string
  customId: string
  params: AnthropicBatchMessageParams
}): Promise<AnthropicMessageBatch> {
  const response = await fetch(`${ANTHROPIC_API_BASE_URL}/messages/batches`, {
    method: 'POST',
    headers: buildAnthropicHeaders(apiKey),
    body: JSON.stringify({
      requests: [
        {
          custom_id: customId,
          params,
        },
      ],
    }),
  })

  return parseAnthropicJsonResponse<AnthropicMessageBatch>(response, 'create message batch')
}

export async function retrieveAnthropicMessageBatch({
  apiKey,
  batchId,
}: {
  apiKey: string
  batchId: string
}): Promise<AnthropicMessageBatch> {
  const response = await fetch(`${ANTHROPIC_API_BASE_URL}/messages/batches/${batchId}`, {
    method: 'GET',
    headers: buildAnthropicHeaders(apiKey),
  })

  return parseAnthropicJsonResponse<AnthropicMessageBatch>(response, 'retrieve message batch')
}

export async function retrieveAnthropicBatchResult({
  apiKey,
  resultsUrl,
  customId,
}: {
  apiKey: string
  resultsUrl: string
  customId: string
}): Promise<AnthropicBatchResult | null> {
  const response = await fetch(resultsUrl, {
    method: 'GET',
    headers: buildAnthropicHeaders(apiKey),
  })

  if (!response.ok) {
    throw new Error(
      `Anthropic failed to retrieve message batch results (${response.status}): ${await safeResponseText(
        response,
      )}`,
    )
  }

  const body = await response.text()
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    const parsed = JSON.parse(trimmed) as AnthropicBatchResult
    if (parsed.custom_id === customId) {
      return parsed
    }
  }

  return null
}

export function extractTextFromAnthropicBatchMessage(message: AnthropicBatchMessageResult): string {
  return message.content
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('')
}

function buildAnthropicHeaders(apiKey: string): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  }
}

async function parseAnthropicJsonResponse<T>(response: Response, action: string): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `Anthropic failed to ${action} (${response.status}): ${text || 'Unknown error'}`,
    )
  }

  return JSON.parse(text) as T
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()) || 'Unknown error'
  } catch {
    return 'Unknown error'
  }
}
