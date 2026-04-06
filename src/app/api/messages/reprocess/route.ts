import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserRateLimit } from '@/lib/chat/rate-limiter'
import { streamText } from 'ai'
import { buildLanguageModel } from '@/lib/llm/model-factory'
import { getDefaultModelForProvider } from '@/lib/models'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 60

const STREAM_UPDATE_INTERVAL_MS = 200

const reprocessRequestSchema = z.object({
  messageId: z.string().min(1),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { allowed, retryAfter } = await checkUserRateLimit(user.id)
  if (!allowed) {
    return new Response('Too many requests', {
      status: 429,
      headers: { 'Retry-After': String(retryAfter ?? 60) },
    })
  }

  const parsed = reprocessRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return new Response('Missing messageId', { status: 400 })
  }
  const { messageId } = parsed.data

  // 1. Fetch the message to reprocess
  const { data: message, error: messageError } = await supabase
    .from('messages')
    .select('id, chat_id, role, content, user_id')
    .eq('id', messageId)
    .single()

  if (messageError || !message) {
    return new Response('Message not found', { status: 404 })
  }

  if (message.user_id !== user.id) {
    return new Response('Forbidden', { status: 403 })
  }

  if (message.role !== 'assistant') {
    return new Response('Only assistant messages can be reprocessed', { status: 400 })
  }

  // 2. Fetch user's reprocess settings from profiles
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('reprocess_prompt, reprocess_api_key_id')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return new Response('Profile not found', { status: 404 })
  }

  if (!profile.reprocess_prompt || !profile.reprocess_api_key_id) {
    return new Response(
      'Reprocess settings not configured. Please set prompt and API key in settings.',
      { status: 400 },
    )
  }

  // 3. Fetch API key details
  const { data: apiKeyData, error: apiKeyError } = await supabase
    .from('api_keys')
    .select('*')
    .eq('id', profile.reprocess_api_key_id)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (apiKeyError || !apiKeyData) {
    return new Response('API key not found or inactive', { status: 400 })
  }

  // 4. Decrypt API key from Vault (requires admin client)
  const adminSupabase = createAdminClient()
  let decryptedApiKey: string
  try {
    decryptedApiKey = await decryptSecret({
      supabase: adminSupabase,
      secretName: apiKeyData.vault_secret_name,
      requester: user.id,
    })
  } catch {
    return new Response('Failed to decrypt API key', { status: 500 })
  }

  // 5. Build language model
  const model = buildLanguageModel({
    provider: apiKeyData.provider,
    modelName:
      apiKeyData.model_preference ??
      getDefaultModelForProvider(apiKeyData.provider, { lightweight: true }),
    apiKey: decryptedApiKey,
    serviceTier: apiKeyData.service_tier,
  })

  // 6. Stream text and update message in DB
  try {
    const stream = await streamText({
      model,
      system: profile.reprocess_prompt,
      messages: [{ role: 'user', content: message.content }],
      temperature: 1,
    })

    let fullText = ''
    let lastUpdateAt = 0
    let updateInFlight: Promise<void> | null = null
    let updateError: Error | null = null
    let queuedUpdateContent: string | null = null

    const enqueueMessageUpdate = (content: string) => {
      if (updateError) {
        return
      }
      if (updateInFlight) {
        queuedUpdateContent = content
        return
      }

      const contentSnapshot = content
      updateInFlight = (async () => {
        const { error: messageUpdateError } = await supabase
          .from('messages')
          .update({ content: contentSnapshot })
          .eq('id', messageId)
          .eq('user_id', user.id)

        if (messageUpdateError) {
          throw new Error(`Failed to update message content: ${messageUpdateError.message}`)
        }
      })()
        .catch((error) => {
          updateError = error instanceof Error ? error : new Error(String(error))
        })
        .finally(() => {
          updateInFlight = null
          if (queuedUpdateContent && !updateError) {
            const nextContent = queuedUpdateContent
            queuedUpdateContent = null
            enqueueMessageUpdate(nextContent)
          } else {
            queuedUpdateContent = null
          }
        })
    }

    const flushMessageUpdates = async () => {
      if (updateError) {
        throw updateError
      }
      while (updateInFlight) {
        await updateInFlight
        if (updateError) {
          throw updateError
        }
      }
    }

    for await (const chunk of stream.textStream) {
      if (updateError) {
        throw updateError
      }
      fullText += chunk
      const now = Date.now()

      // Update DB every 200ms
      if (now - lastUpdateAt >= STREAM_UPDATE_INTERVAL_MS) {
        enqueueMessageUpdate(fullText)
        lastUpdateAt = now
      }
    }

    enqueueMessageUpdate(fullText)
    await flushMessageUpdates()

    // Final update with complete text
    const { error: finalUpdateError } = await supabase
      .from('messages')
      .update({
        content: fullText,
        model_used:
          apiKeyData.model_preference ??
          getDefaultModelForProvider(apiKeyData.provider, { lightweight: true }),
      })
      .eq('id', messageId)
      .eq('user_id', user.id)

    if (finalUpdateError) {
      console.error('[Reprocess] Final update failed:', finalUpdateError)
      return new Response('Failed to save reprocessed message', { status: 500 })
    }

    // Update api_keys.last_used_at
    await supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', apiKeyData.id)

    return Response.json({ success: true, content: fullText })
  } catch (error) {
    console.error('[Reprocess] Streaming failed:', error)
    return new Response('Failed to reprocess message', { status: 500 })
  }
}

// Helper functions

async function decryptSecret({
  supabase,
  secretName,
  requester,
}: {
  supabase: SupabaseClient
  secretName: string
  requester: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('get_decrypted_secret', {
    secret_name: secretName,
    requester,
  })

  if (error) {
    console.error('[Reprocess] Vault decryption failed:', error)
    throw new Error('Vault decryption failed')
  }

  if (!data) {
    throw new Error('Vault returned empty secret')
  }

  return data
}
