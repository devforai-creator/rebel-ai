import { z } from 'zod'

export interface ApiErrorBody {
  error: string
  code?: string
  retryAfter?: number | null
}

type InvalidBodyMessage = string | ((error: z.ZodError) => string)

export function createApiErrorResponse(
  message: string,
  status: number,
  options?: {
    code?: string
    headers?: HeadersInit
    retryAfter?: number | null
  },
): Response {
  const body: ApiErrorBody = { error: message }

  if (options?.code) {
    body.code = options.code
  }

  if (options && 'retryAfter' in options) {
    body.retryAfter = options.retryAfter ?? null
  }

  return Response.json(body, {
    status,
    headers: options?.headers,
  })
}

export async function parseJsonRequest<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
  options?: {
    invalidJsonMessage?: string
    invalidJsonCode?: string
    invalidBodyMessage?: InvalidBodyMessage
    invalidBodyCode?: string
    headers?: HeadersInit
  },
): Promise<{ success: true; data: z.output<TSchema> } | { success: false; response: Response }> {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return {
      success: false,
      response: createApiErrorResponse(options?.invalidJsonMessage ?? 'Invalid request body', 400, {
        code: options?.invalidJsonCode ?? 'invalid_json',
        headers: options?.headers,
      }),
    }
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const message =
      typeof options?.invalidBodyMessage === 'function'
        ? options.invalidBodyMessage(parsed.error)
        : (options?.invalidBodyMessage ?? 'Invalid request body')

    return {
      success: false,
      response: createApiErrorResponse(message, 400, {
        code: options?.invalidBodyCode ?? 'invalid_request',
        headers: options?.headers,
      }),
    }
  }

  return {
    success: true,
    data: parsed.data,
  }
}

export async function readApiErrorMessage(
  response: Response,
  fallback = 'Request failed',
): Promise<string> {
  try {
    const data = (await response.clone().json()) as unknown
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error
    }
  } catch {
    // Fall through to raw text parsing.
  }

  try {
    const text = await response.text()
    if (text) {
      return text
    }
  } catch {
    // Ignore and fall back to default message.
  }

  return fallback
}
