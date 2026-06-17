import type { SupabaseClientOptions, WebSocketLikeConstructor } from '@supabase/supabase-js'

class UnsupportedServerRealtimeTransport {
  constructor() {
    throw new Error(
      'Supabase realtime is not available on server-side clients. Use the browser Supabase client for realtime channels.',
    )
  }
}

export const serverSupabaseRealtimeOptions = {
  realtime: {
    transport: UnsupportedServerRealtimeTransport as unknown as WebSocketLikeConstructor,
  },
} satisfies Pick<SupabaseClientOptions<'public'>, 'realtime'>
