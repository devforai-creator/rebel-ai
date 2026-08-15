import { resolveDashboardReturnPath } from '@/lib/navigation/dashboard-return'

const CHARACTER_LIST_PATH = '/dashboard/characters'
const RECENT_CONVERSATIONS_PATH = '/dashboard/chats'

export type CharacterDetailReturnDestination = {
  href: typeof CHARACTER_LIST_PATH | typeof RECENT_CONVERSATIONS_PATH
  label: '← 캐릭터 목록' | '← Recent Conversations'
}

export function buildRecentCharacterDetailHref(characterId: string): string {
  const searchParams = new URLSearchParams({
    returnTo: RECENT_CONVERSATIONS_PATH,
  })

  return `/dashboard/characters/${encodeURIComponent(characterId)}?${searchParams.toString()}`
}

export function resolveCharacterDetailReturnDestination(
  returnTo: string | string[] | undefined,
): CharacterDetailReturnDestination {
  const safeReturnPath =
    typeof returnTo === 'string'
      ? resolveDashboardReturnPath(returnTo, CHARACTER_LIST_PATH)
      : CHARACTER_LIST_PATH

  if (safeReturnPath === RECENT_CONVERSATIONS_PATH) {
    return {
      href: RECENT_CONVERSATIONS_PATH,
      label: '← Recent Conversations',
    }
  }

  return {
    href: CHARACTER_LIST_PATH,
    label: '← 캐릭터 목록',
  }
}
