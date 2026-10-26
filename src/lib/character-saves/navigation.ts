import { resolveDashboardReturnPath } from '@/lib/navigation/dashboard-return'

export function buildSaveManagementHref({
  characterId,
  saveId,
  returnTo,
}: {
  characterId?: string | null
  saveId?: string | null
  returnTo?: string
} = {}): string {
  const params = new URLSearchParams()
  if (characterId) params.set('character', characterId)
  if (saveId) params.set('save', saveId)
  if (returnTo) params.set('returnTo', resolveDashboardReturnPath(returnTo))
  const query = params.toString()
  return '/dashboard/saves' + (query ? '?' + query : '')
}
