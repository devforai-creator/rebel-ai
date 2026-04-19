import {
  createApiErrorResponse,
  createUnexpectedRouteErrorResponse,
  requireAuthenticatedUser,
} from '@/lib/http/api-contract'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AnnouncementPayload = {
  id: string
  message: string
  ctaLabel: string | null
  ctaUrl: string | null
  severity: string
  startsAt: string
  endsAt: string | null
}

export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireAuthenticatedUser(supabase)
    if (!auth.success) {
      return auth.response
    }

    const nowIso = new Date().toISOString()
    const { data, error } = await supabase
      .from('announcements')
      .select('id, message, cta_label, cta_url, severity, starts_at, ends_at, is_active')
      .eq('is_active', true)
      .lte('starts_at', nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[Announcements API] Failed to fetch announcement:', error)
      return createApiErrorResponse('Failed to fetch announcement', 500)
    }

    const payload: AnnouncementPayload | null = data
      ? {
          id: data.id,
          message: data.message,
          ctaLabel: data.cta_label,
          ctaUrl: data.cta_url,
          severity: data.severity,
          startsAt: data.starts_at,
          endsAt: data.ends_at,
        }
      : null

    return Response.json({ announcement: payload })
  } catch (error) {
    return createUnexpectedRouteErrorResponse('[Announcements API] Unexpected error:', error)
  }
}
