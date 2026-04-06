import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isLLMProvider } from '@/lib/api-keys/provider-utils'

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

  const apiKeys = (apiKeysResult.data ?? []).filter((key) => isLLMProvider(key.provider))
  const personas = personasResult.data ?? []

  return NextResponse.json({ apiKeys, personas })
}
