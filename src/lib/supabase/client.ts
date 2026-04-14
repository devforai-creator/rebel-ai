import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type AppSupabaseClient = SupabaseClient<Database>

export function createClient(): AppSupabaseClient {
  // Supabase SSR returns a more specific generic signature than the app-wide alias uses.
  // Keep the cast confined to this factory boundary so the rest of the app stays typed.
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  ) as unknown as AppSupabaseClient
}
