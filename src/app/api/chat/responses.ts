import { NextResponse } from 'next/server'

export function createErrorResponse(
  message: string,
  status: number,
  options?: {
    retryAfter?: number | null
    headers?: HeadersInit
  },
) {
  const body: {
    error: string
    retryAfter?: number | null
  } = { error: message }

  if (options && 'retryAfter' in options) {
    body.retryAfter = options.retryAfter ?? null
  }

  return NextResponse.json(body, {
    status,
    headers: options?.headers,
  })
}
