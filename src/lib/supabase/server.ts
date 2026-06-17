import 'server-only'

import { createServerClient, type SetAllCookies } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database.types'

type AppSupabaseClient = SupabaseClient<Database>
type SupabaseCookiesToSet = Parameters<SetAllCookies>[0]

export async function createClient(): Promise<AppSupabaseClient> {
  const cookieStore = await cookies()

  // Supabase SSR returns a more specific generic signature than the app-wide alias uses.
  // Keep the cast confined to this factory boundary so the rest of the app stays typed.
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: SupabaseCookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Component에서는 set 호출 불가 - 무시
          }
        },
      },
    },
  ) as unknown as AppSupabaseClient
}
