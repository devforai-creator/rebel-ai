import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isLLMProvider } from '@/lib/api-keys/provider-utils'
import type {
  ChatOptionsApiKey,
  ChatOptionsPersona,
  ChatOptionsResponse,
} from '@/lib/chat-options/contracts'

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [apiKeysResult, personasResult] = await Promise.all([
    supabase
      .from('api_keys')
      .select('id, key_name, provider, model_preference')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('provider'),
    supabase
      .from('personas')
      .select('id, name, description')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ])

  if (apiKeysResult.error) {
    console.error('[Chat options] Failed to load API keys', apiKeysResult.error)
  }

  if (personasResult.error) {
    console.error('[Chat options] Failed to load personas', personasResult.error)
  }

  const apiKeys: ChatOptionsApiKey[] = (apiKeysResult.data ?? [])
    .filter((key) => isLLMProvider(key.provider))
    .map((key) => ({
      id: key.id,
      key_name: key.key_name,
      provider: key.provider as ChatOptionsApiKey['provider'],
      model_preference: key.model_preference,
    }))
  const personas: ChatOptionsPersona[] = (personasResult.data ?? []).map((persona) => ({
    id: persona.id,
    name: persona.name,
    description: persona.description,
  }))

  const responseBody: ChatOptionsResponse = { apiKeys, personas }
  return NextResponse.json(responseBody)
}
