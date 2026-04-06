import { NextResponse } from 'next/server'
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
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
      return NextResponse.json({ error: 'Failed to fetch announcement' }, { status: 500 })
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

    return NextResponse.json({ announcement: payload })
  } catch (error) {
    console.error('[Announcements API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
