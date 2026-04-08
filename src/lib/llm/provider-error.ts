type ProviderErrorCategory =
  | 'rate_limit'
  | 'quota'
  | 'auth'
  | 'context_length'
  | 'content_filter'
  | 'unknown'

export type NormalizedProviderError = {
  category: ProviderErrorCategory
  userMessage: string
  technicalMessage: string | null
  providerCode: string | null
  retryable: boolean
  recognized: boolean
}

type ParsedProviderError = {
  message: string | null
  type: string | null
  code: string | null
  statusCode: number | null
  contentFilterReason: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function extractBodyError(body: unknown): ParsedProviderError | null {
  if (!isRecord(body)) {
    return null
  }

  const nested = isRecord(body.error) ? body.error : body

  return {
    message: getString(nested.message),
    type: getString(nested.type),
    code: getString(nested.code),
    statusCode: getNumber(body.statusCode),
    contentFilterReason:
      isRecord(body.promptFeedback) && typeof body.promptFeedback.blockReason === 'string'
        ? body.promptFeedback.blockReason
        : null,
  }
}

function parseProviderError(error: unknown): ParsedProviderError {
  const fallback = {
    message: error instanceof Error ? error.message : getString(error),
    type: null,
    code: null,
    statusCode: null,
    contentFilterReason: null,
  }

  if (!isRecord(error)) {
    return fallback
  }

  const direct = extractBodyError(error)
  const statusCode = getNumber(error.statusCode) ?? getNumber(error.status)

  let fromBody: ParsedProviderError | null = null
  if (typeof error.responseBody === 'string') {
    try {
      fromBody = extractBodyError(JSON.parse(error.responseBody))
    } catch {
      fromBody = null
    }
  }

  return {
    message: direct?.message ?? fromBody?.message ?? fallback.message,
    type: direct?.type ?? fromBody?.type ?? fallback.type,
    code: direct?.code ?? fromBody?.code ?? fallback.code,
    statusCode: statusCode ?? fromBody?.statusCode ?? fallback.statusCode,
    contentFilterReason:
      direct?.contentFilterReason ?? fromBody?.contentFilterReason ?? fallback.contentFilterReason,
  }
}

function includesAny(haystack: string | null, needles: string[]) {
  if (!haystack) {
    return false
  }

  const normalized = haystack.toLowerCase()
  return needles.some((needle) => normalized.includes(needle))
}

function getProviderLabel(provider: string) {
  if (provider === 'openai') {
    return 'OpenAI'
  }

  return 'The provider'
}

export function normalizeProviderError({
  provider,
  error,
}: {
  provider: string
  error: unknown
}): NormalizedProviderError {
  const parsed = parseProviderError(error)
  const message = parsed.message
  const code = parsed.code?.toLowerCase() ?? null
  const type = parsed.type?.toLowerCase() ?? null
  const statusCode = parsed.statusCode
  const providerLabel = getProviderLabel(provider)

  if (parsed.contentFilterReason === 'PROHIBITED_CONTENT') {
    return {
      category: 'content_filter',
      userMessage:
        'Google Gemini blocked the prompt as prohibited content. Try using a different LLM provider (OpenAI, Anthropic) or modify the character/prompt content.',
      technicalMessage: message,
      providerCode: parsed.code,
      retryable: false,
      recognized: true,
    }
  }

  if (
    code === 'rate_limit_exceeded' ||
    includesAny(code, ['rate_limit']) ||
    includesAny(type, ['rate_limit']) ||
    includesAny(message, ['rate limit', 'too many requests', 'too many tokens'])
  ) {
    return {
      category: 'rate_limit',
      userMessage: `${providerLabel} is currently rate limiting requests. Please try again in a moment.`,
      technicalMessage: message,
      providerCode: parsed.code,
      retryable: true,
      recognized: true,
    }
  }

  if (code === 'insufficient_quota' || includesAny(message, ['quota', 'billing'])) {
    return {
      category: 'quota',
      userMessage: `${provider === 'openai' ? 'This OpenAI API key' : 'This API key'} has exhausted its quota or billing limit. Check billing or use a different API key.`,
      technicalMessage: message,
      providerCode: parsed.code,
      retryable: false,
      recognized: true,
    }
  }

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    code === 'invalid_api_key' ||
    includesAny(message, ['api key', 'unauthorized', 'authentication'])
  ) {
    return {
      category: 'auth',
      userMessage:
        'Authentication with the model provider failed. Check the selected API key and try again.',
      technicalMessage: message,
      providerCode: parsed.code,
      retryable: false,
      recognized: true,
    }
  }

  if (
    code === 'context_length_exceeded' ||
    includesAny(message, ['maximum context length', 'context length', 'too many input tokens'])
  ) {
    return {
      category: 'context_length',
      userMessage:
        'The conversation context is too large for this model. Trim the chat history or use a model with a larger context window.',
      technicalMessage: message,
      providerCode: parsed.code,
      retryable: false,
      recognized: true,
    }
  }

  if (includesAny(message, ['content filter', 'safety system', 'blocked'])) {
    return {
      category: 'content_filter',
      userMessage:
        'The provider blocked this request because of content safety rules. Try changing the prompt or switching providers.',
      technicalMessage: message,
      providerCode: parsed.code,
      retryable: false,
      recognized: true,
    }
  }

  return {
    category: 'unknown',
    userMessage: message ?? 'Upstream provider request failed. Please try again later.',
    technicalMessage: message,
    providerCode: parsed.code,
    retryable: statusCode !== null ? statusCode >= 500 : false,
    recognized: false,
  }
}
