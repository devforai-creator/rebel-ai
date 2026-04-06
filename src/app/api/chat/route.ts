import { createClient } from '@/lib/supabase/server'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import {
  CHAT_JOB_PAYLOAD_VERSION,
  type ChatGenerationJobPayload,
  serializeChatJobPayload,
} from '@/lib/chat/job-payload'
import {
  checkUserRateLimit,
  checkAnonRateLimit,
  buildClientIdentifier,
} from '@/lib/chat/rate-limiter'
import {
  ACTIVE_CHAT_JOB_CONFLICT_MESSAGE,
  ACTIVE_QUEUE_JOB_STATUSES,
  MAX_ACTIVE_CHAT_JOBS_PER_USER,
  buildActiveChatJobLimitMessage,
  isChatJobUserLimitViolation,
  isUniqueViolation,
} from '@/lib/queue/admission'
import { isLLMProvider } from '@/lib/api-keys/provider-utils'
import { getDefaultModelForProvider } from '@/lib/llm/default-model'
import { triggerMessageTranslation } from '@/lib/chat/translation-trigger'
import { buildInternalApiUrl } from '@/lib/internal-api-origin'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 60 // 60 second timeout

// Increased to 256KB to support characters with large first message templates
// (e.g., RisuAI First Message Selector with multiple variations)
const MAX_MESSAGE_BYTES = 262_144 // 256KB per message
const MAX_CHAT_REQUEST_BODY_BYTES = 5_308_416 // ~5MB to cap parsing cost even when platform limits are loose
const CHAT_API_DEBUG_ENABLED = process.env.CHAT_API_DEBUG === 'true'

function logChatApiDebug(...args: unknown[]): void {
  if (CHAT_API_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

const chatRequestSchema = z
  .object({
    messages: z.array(z.unknown()).optional().nullable(),
    chatId: z.unknown().optional(),
    apiKeyId: z.unknown().optional(),
    isRegeneration: z.unknown().optional(),
    regenerateAssistantMessageId: z.unknown().optional(),
  })
  .passthrough()

// Rate limiter utility is now imported from '@/lib/chat/rate-limiter'

export async function POST(req: Request) {
  try {
    const declaredContentLength = parseDeclaredContentLength(req.headers.get('content-length'))
    if (
      typeof declaredContentLength === 'number' &&
      declaredContentLength > MAX_CHAT_REQUEST_BODY_BYTES
    ) {
      return new Response('Request body exceeds allowed size', { status: 413 })
    }

    const supabase = await createClient()
    const requestId = crypto.randomUUID()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      const clientIdentifier = await extractClientIdentifier(req)
      const { allowed, retryAfter } = await checkAnonRateLimit(clientIdentifier)

      if (!allowed) {
        return new Response(
          JSON.stringify({
            error: 'Too many requests',
            retryAfter,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(retryAfter),
            },
          },
        )
      }

      return new Response('Unauthorized', { status: 401 })
    }

    const { allowed, retryAfter } = await checkUserRateLimit(user.id)

    if (!allowed) {
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter ?? 60),
          },
        },
      )
    }

    const parsed = chatRequestSchema.safeParse(await req.json().catch(() => null))

    if (!parsed.success) {
      return new Response('Invalid request body', { status: 400 })
    }

    const {
      messages,
      chatId,
      apiKeyId,
      isRegeneration: rawIsRegeneration,
      regenerateAssistantMessageId: rawRegenerateAssistantMessageId,
    } = parsed.data

    if (typeof chatId !== 'string' || !chatId) {
      return new Response('Invalid chatId', { status: 400 })
    }

    if (typeof apiKeyId !== 'string' || !apiKeyId) {
      return new Response('Invalid apiKeyId', { status: 400 })
    }

    const sanitizedMessages: SanitizedMessage[] = Array.isArray(messages)
      ? messages
          .filter((message): message is { role: string; content: string } => {
            if (!message || typeof message !== 'object') {
              return false
            }
            const candidate = message as Record<string, unknown>
            return typeof candidate.role === 'string' && typeof candidate.content === 'string'
          })
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .map((message) => ({
            role: message.role as 'user' | 'assistant',
            content: message.content,
          }))
      : []

    if (sanitizedMessages.length === 0) {
      return new Response('Messages array required', { status: 400 })
    }

    const textEncoder = new TextEncoder()
    const oversizedMessage = sanitizedMessages.find((message) => {
      const byteLength = textEncoder.encode(message.content).length
      return byteLength > MAX_MESSAGE_BYTES
    })

    if (oversizedMessage) {
      return new Response('Message exceeds allowed size', { status: 400 })
    }

    const lastMessage = sanitizedMessages[sanitizedMessages.length - 1]

    if (lastMessage.role !== 'user' || !lastMessage.content.trim()) {
      return new Response('Last message must be a non-empty user message', { status: 400 })
    }

    const regenerateAssistantMessageId =
      typeof rawRegenerateAssistantMessageId === 'string' &&
      rawRegenerateAssistantMessageId.trim().length > 0
        ? rawRegenerateAssistantMessageId
        : null

    const isRegeneration = rawIsRegeneration === true || regenerateAssistantMessageId !== null

    const { data: apiKeyData, error: apiKeyError } = await supabase
      .from('api_keys')
      .select('id, provider, model_preference')
      .eq('id', apiKeyId)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (apiKeyError || !apiKeyData) {
      return new Response('API key not found or inactive', { status: 404 })
    }

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, user_id, character_id, persona_id, max_context_messages')
      .eq('id', chatId)
      .eq('user_id', user.id)
      .single()

    if (chatError || !chat) {
      return new Response('Chat not found', { status: 404 })
    }

    const [existingActiveJobResult, activeUserJobsResult] = await Promise.all([
      supabase
        .from('chat_generation_jobs')
        .select('id, status')
        .eq('chat_id', chatId)
        .in('status', [...ACTIVE_QUEUE_JOB_STATUSES])
        .limit(1),
      supabase
        .from('chat_generation_jobs')
        .select('id')
        .eq('user_id', user.id)
        .in('status', [...ACTIVE_QUEUE_JOB_STATUSES]),
    ])

    if (existingActiveJobResult.error) {
      console.error('[Chat API] Failed to check active chat job', {
        chatId,
        requestId,
        error: existingActiveJobResult.error.message,
      })
      return new Response('Failed to inspect active chat jobs', { status: 500 })
    }

    if ((existingActiveJobResult.data?.length ?? 0) > 0) {
      return new Response(ACTIVE_CHAT_JOB_CONFLICT_MESSAGE, { status: 409 })
    }

    if (activeUserJobsResult.error) {
      console.error('[Chat API] Failed to count active user jobs', {
        chatId,
        requestId,
        error: activeUserJobsResult.error.message,
      })
      return new Response('Failed to inspect active chat jobs', { status: 500 })
    }

    if ((activeUserJobsResult.data?.length ?? 0) >= MAX_ACTIVE_CHAT_JOBS_PER_USER) {
      return new Response(buildActiveChatJobLimitMessage(), { status: 429 })
    }

    if (regenerateAssistantMessageId) {
      const { data: targetMessage, error: targetMessageError } = await supabase
        .from('messages')
        .select('id, chat_id, role')
        .eq('id', regenerateAssistantMessageId)
        .single()

      if (
        targetMessageError ||
        !targetMessage ||
        targetMessage.chat_id !== chatId ||
        targetMessage.role !== 'assistant'
      ) {
        console.warn('[Chat API] Invalid regeneration target', {
          chatId,
          requestId,
          targetId: regenerateAssistantMessageId,
        })
        return new Response('Invalid regeneration target', { status: 400 })
      }
    }

    if (!isLLMProvider(apiKeyData.provider)) {
      return new Response('Unsupported provider', { status: 400 })
    }

    const provider = apiKeyData.provider
    const modelName = apiKeyData.model_preference || getDefaultModelForProvider(provider)

    let insertedUserMessageId: string | null = null

    if (!isRegeneration) {
      const userMessage = sanitizedMessages[sanitizedMessages.length - 1]

      if (userMessage?.role !== 'user' || !userMessage.content.trim()) {
        return new Response('Invalid user message', { status: 400 })
      }

      const { data: insertedMessage, error: insertUserError } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          role: 'user',
          content: userMessage.content,
          user_id: user.id,
        })
        .select('id')
        .single()

      if (insertUserError || !insertedMessage) {
        console.error('[Chat API] Failed to persist user message', {
          chatId,
          requestId,
          error: insertUserError?.message,
        })
        return new Response('Failed to save user message', { status: 500 })
      }

      insertedUserMessageId = insertedMessage.id
    }

    const jobPayload: ChatGenerationJobPayload = {
      version: CHAT_JOB_PAYLOAD_VERSION,
      requestId,
      chatId,
      userId: user.id,
      apiKeyId,
      provider,
      modelName,
      sanitizedMessages,
      isRegeneration,
      regenerateAssistantMessageId,
    }

    const { data: job, error: jobError } = await supabase
      .from('chat_generation_jobs')
      .insert({
        chat_id: chatId,
        user_id: user.id,
        status: 'pending',
        payload: serializeChatJobPayload(jobPayload),
      })
      .select('id')
      .single()

    if (jobError || !job) {
      if (insertedUserMessageId) {
        await rollbackPersistedUserMessage(supabase, insertedUserMessageId, chatId, requestId)
      }

      if (isUniqueViolation(jobError)) {
        return new Response(ACTIVE_CHAT_JOB_CONFLICT_MESSAGE, { status: 409 })
      }

      if (isChatJobUserLimitViolation(jobError)) {
        return new Response(buildActiveChatJobLimitMessage(), { status: 429 })
      }

      console.error('[Chat API] Failed to enqueue chat generation job', {
        chatId,
        requestId,
        error: jobError?.message,
      })
      return new Response('Failed to queue chat response', { status: 500 })
    }

    if (insertedUserMessageId) {
      // Fire-and-forget: trigger background translation for user message
      triggerMessageTranslation(insertedUserMessageId, user.id)
    }

    // Trigger job runner immediately (fire-and-forget)
    // Cron still runs as backup for any missed jobs
    const adminSecret = process.env.CHAT_ADMIN_SECRET
    if (adminSecret) {
      const jobRunnerUrl = buildInternalApiUrl('/api/internal/chat-job-runner').toString()

      logChatApiDebug('[Chat API] Triggering job runner', {
        chatId,
        requestId,
        jobRunnerUrl,
        vercelEnv: process.env.VERCEL_ENV,
      })

      fetch(jobRunnerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSecret}`,
          ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
            'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          }),
        },
        body: JSON.stringify({ limit: 1 }),
      }).catch((err) => {
        // Job is still queued and will be picked up by cron as backup
        console.error('[Chat API] Failed to trigger job runner', {
          chatId,
          requestId,
          jobId: job.id,
          jobRunnerUrl,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }

    return new Response(
      JSON.stringify({
        jobId: job.id,
        requestId,
      }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  } catch (error) {
    // Note: chatId/requestId may not be available if error occurs early in the flow
    console.error('[Chat API] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return new Response('Internal server error', { status: 500 })
  }
}

type RouteSupabaseClient = Awaited<ReturnType<typeof createClient>>

async function rollbackPersistedUserMessage(
  supabase: RouteSupabaseClient,
  messageId: string,
  chatId: string,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.from('messages').delete().eq('id', messageId)
  if (error) {
    console.error('[Chat API] Failed to rollback persisted user message', {
      chatId,
      requestId,
      messageId,
      error: error.message,
    })
  }
}

async function extractClientIdentifier(req: Request): Promise<string> {
  const candidates = [req.headers.get('x-vercel-ip'), req.headers.get('cf-connecting-ip')]

  if (shouldTrustProxyIpHeaders()) {
    const forwardedFor = req.headers.get('x-forwarded-for')
    candidates.push(req.headers.get('x-real-ip'), ...getForwardedForClientIps(forwardedFor))
  }

  let firstValidIp: string | null = null

  for (const candidate of candidates) {
    const normalized = normalizePotentialIp(candidate)
    if (!normalized) {
      continue
    }

    if (!firstValidIp) {
      firstValidIp = normalized
    }

    if (!isPrivateIp(normalized)) {
      return normalized
    }
  }

  if (firstValidIp) {
    return firstValidIp
  }

  return buildHashedUserAgentIdentifier(req)
}

function getForwardedForClientIps(headerValue: string | null): string[] {
  if (!headerValue) {
    return []
  }

  return headerValue
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function normalizePotentialIp(candidate: string | null): string | null {
  if (!candidate) {
    return null
  }

  const trimmed = candidate.trim()
  if (!trimmed) {
    return null
  }

  return trimmed
}

function parseDeclaredContentLength(headerValue: string | null): number | null {
  if (!headerValue) {
    return null
  }

  const parsed = Number.parseInt(headerValue, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  return parsed
}

function shouldTrustProxyIpHeaders(): boolean {
  return process.env.TRUST_PROXY_IP_HEADERS === 'true'
}

function isPrivateIp(ip: string): boolean {
  const privateRanges = [
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
    /^127\./,
    /^fc00:/i,
    /^fe80:/i,
    /^::1$/,
  ]

  return privateRanges.some((range) => range.test(ip))
}

function buildHashedUserAgentIdentifier(req: Request): string {
  const ua = req.headers.get('user-agent') ?? 'unknown'
  const acceptLanguage = req.headers.get('accept-language') ?? 'unknown'
  const rawIdentifier = `${ua}|${acceptLanguage}`
  return buildClientIdentifier(rawIdentifier)
}

// Unused internal API utilities removed
