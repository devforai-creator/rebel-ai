import type { AnnouncementSeverity } from '@/types/database.types'

export type AnnouncementPayload = {
  id: string
  message: string
  ctaLabel: string | null
  ctaUrl: string | null
  severity: AnnouncementSeverity
  startsAt: string
  endsAt: string | null
}

export type AnnouncementResponse = {
  announcement: AnnouncementPayload | null
}
