import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

/**
 * Creates a fresh Supabase admin client for each call.
 *
 * NOTE: We intentionally avoid singleton caching here because Vercel Serverless
 * functions can be "warm started" with stale connections from previous invocations.
 * This caused intermittent "Failed to update assistant message content" errors
 * during long streaming operations in production.
 *
 * The Supabase JS client uses REST API (not persistent connections), so the
 * overhead of creating a new client per request is minimal.
 */
export function createAdminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: (url, options) => {
        // Increase fetch timeout for long-running operations (default may be too short)
        return fetch(url, {
          ...options,
          signal: AbortSignal.timeout(30_000), // 30 second timeout per request
        })
      },
    },
  })
}
