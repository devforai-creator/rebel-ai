'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { User } from '@supabase/supabase-js'
import type {
  Announcement,
  AnnouncementInsert,
  AnnouncementUpdate,
  AnnouncementSeverity,
} from '@/types/database.types'

type BaseResult = {
  error?: string
  success?: boolean
}

type AnnouncementMutationResult = { error: string } | { announcement: Announcement }

type CreateAnnouncementInput = {
  message: string
  severity: AnnouncementSeverity
  ctaLabel?: string | null
  ctaUrl?: string | null
  startsAt?: string | null
  endsAt?: string | null
  isActive?: boolean
}

type UpdateAnnouncementInput = Partial<Omit<CreateAnnouncementInput, 'isActive'>> & {
  isActive?: boolean
}

const adminSupabase = createAdminClient()
const ADMIN_PATH = '/dashboard/admin/announcements'
const MAX_MESSAGE_LENGTH = 1500

type AdminContext = { user: User } | { error: string }

async function ensureAdminUser(): Promise<AdminContext> {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { error: '로그인이 필요합니다.' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return { error: '프로필 정보를 불러오지 못했습니다.' }
  }

  if (!profile.is_admin) {
    return { error: '관리자 권한이 필요합니다.' }
  }

  return { user }
}

function parseDateValue(value?: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const timestamp = Date.parse(trimmed)
  if (Number.isNaN(timestamp)) {
    return { error: '날짜 형식이 올바르지 않습니다.' }
  }
  return new Date(timestamp).toISOString()
}

function validateAnnouncementInput(
  input: Partial<CreateAnnouncementInput>,
  { requireMessage }: { requireMessage: boolean },
) {
  if (requireMessage) {
    if (!input.message || !input.message.trim()) {
      return { error: '공지 내용을 입력해주세요.' }
    }
  } else if (input.message !== undefined && !input.message.trim()) {
    return { error: '공지 내용은 비워둘 수 없습니다.' }
  }

  if (input.message && input.message.length > MAX_MESSAGE_LENGTH) {
    return {
      error: `공지 내용은 ${MAX_MESSAGE_LENGTH}자 이하여야 합니다.`,
    }
  }

  if (input.severity && !['info', 'warning', 'critical'].includes(input.severity)) {
    return { error: '유효하지 않은 중요도입니다.' }
  }

  if (input.ctaUrl) {
    const isValidUrl =
      input.ctaUrl.startsWith('http://') ||
      input.ctaUrl.startsWith('https://') ||
      input.ctaUrl.startsWith('/')
    if (!isValidUrl) {
      return { error: 'CTA URL은 http(s):// 혹은 / 로 시작해야 합니다.' }
    }
  }

  return null
}

export async function createAnnouncement(
  input: CreateAnnouncementInput,
): Promise<AnnouncementMutationResult> {
  const adminCheck = await ensureAdminUser()
  if ('error' in adminCheck) {
    return adminCheck
  }

  const validationError = validateAnnouncementInput(input, { requireMessage: true })
  if (validationError) {
    return validationError
  }

  const parsedStart = parseDateValue(input.startsAt)
  if (parsedStart && typeof parsedStart === 'object' && 'error' in parsedStart) {
    return parsedStart
  }
  const parsedEnd = parseDateValue(input.endsAt)
  if (parsedEnd && typeof parsedEnd === 'object' && 'error' in parsedEnd) {
    return parsedEnd
  }

  const startIso = typeof parsedStart === 'string' ? parsedStart : null
  const endIso = typeof parsedEnd === 'string' ? parsedEnd : null

  if (startIso && endIso && new Date(startIso).getTime() > new Date(endIso).getTime()) {
    return { error: '종료 시각은 시작 시각보다 이후여야 합니다.' }
  }

  const announcementPayload: AnnouncementInsert = {
    message: input.message.trim(),
    severity: input.severity ?? 'info',
    cta_label: input.ctaLabel?.trim() || null,
    cta_url: input.ctaUrl?.trim() || null,
    starts_at: startIso ?? new Date().toISOString(),
    ends_at: endIso,
    is_active: input.isActive ?? true,
    author_user_id: adminCheck.user.id,
  }

  const { data, error } = await adminSupabase
    .from('announcements')
    .insert(announcementPayload as never)
    .select()
    .single()

  if (error) {
    console.error('[Announcements Admin] Failed to create announcement:', error)
    return { error: '공지 생성 중 오류가 발생했습니다.' }
  }

  revalidatePath(ADMIN_PATH)
  revalidatePath('/dashboard')
  return { announcement: data as Announcement }
}

export async function updateAnnouncement(
  announcementId: string,
  input: UpdateAnnouncementInput,
): Promise<AnnouncementMutationResult> {
  const adminCheck = await ensureAdminUser()
  if ('error' in adminCheck) {
    return adminCheck
  }

  const validationError = validateAnnouncementInput(input, { requireMessage: false })

  if (validationError) {
    return validationError
  }

  let startIso: string | undefined
  if (input.startsAt !== undefined) {
    const parsed = parseDateValue(input.startsAt)
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      return parsed
    }
    startIso = typeof parsed === 'string' ? parsed : undefined
  }

  let endIso: string | null | undefined
  if (input.endsAt !== undefined) {
    const parsed = parseDateValue(input.endsAt)
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      return parsed
    }
    endIso = typeof parsed === 'string' ? parsed : null
  }

  const updatePayload: AnnouncementUpdate = {}

  if (input.message !== undefined) {
    updatePayload.message = input.message.trim()
  }
  if (input.severity !== undefined) {
    updatePayload.severity = input.severity
  }
  if (input.ctaLabel !== undefined) {
    updatePayload.cta_label = input.ctaLabel?.trim() || null
  }
  if (input.ctaUrl !== undefined) {
    updatePayload.cta_url = input.ctaUrl?.trim() || null
  }
  if (startIso !== undefined) {
    updatePayload.starts_at = startIso
  }
  if (endIso !== undefined) {
    updatePayload.ends_at = endIso
  }
  if (input.isActive !== undefined) {
    updatePayload.is_active = input.isActive
  }

  const { data, error } = await adminSupabase
    .from('announcements')
    .update(updatePayload as never)
    .eq('id', announcementId)
    .select()
    .single()

  if (error) {
    console.error('[Announcements Admin] Failed to update announcement:', error)
    return { error: '공지 수정 중 오류가 발생했습니다.' }
  }

  revalidatePath(ADMIN_PATH)
  revalidatePath('/dashboard')
  return { announcement: data as Announcement }
}

export async function toggleAnnouncementStatus(
  announcementId: string,
  nextActive: boolean,
): Promise<BaseResult> {
  const adminCheck = await ensureAdminUser()
  if ('error' in adminCheck) {
    return adminCheck
  }

  const togglePayload: AnnouncementUpdate = { is_active: nextActive }
  const { error } = await adminSupabase
    .from('announcements')
    .update(togglePayload as never)
    .eq('id', announcementId)

  if (error) {
    console.error('[Announcements Admin] Failed to toggle status:', error)
    return { error: '상태 변경 중 문제가 발생했습니다.' }
  }

  revalidatePath(ADMIN_PATH)
  revalidatePath('/dashboard')
  return { success: true }
}

export async function deleteAnnouncement(announcementId: string): Promise<BaseResult> {
  const adminCheck = await ensureAdminUser()
  if ('error' in adminCheck) {
    return adminCheck
  }

  const { error } = await adminSupabase.from('announcements').delete().eq('id', announcementId)

  if (error) {
    console.error('[Announcements Admin] Failed to delete announcement:', error)
    return { error: '공지 삭제 중 오류가 발생했습니다.' }
  }

  revalidatePath(ADMIN_PATH)
  revalidatePath('/dashboard')
  return { success: true }
}
