const APP_ORIGIN = 'https://rebel-ai.local'
const DASHBOARD_PATH = '/dashboard'

export function resolveDashboardReturnPath(
  value: string | undefined,
  fallback = DASHBOARD_PATH,
): string {
  if (!value) {
    return fallback
  }

  try {
    const url = new URL(value, APP_ORIGIN)
    const isDashboardPath =
      url.pathname === DASHBOARD_PATH || url.pathname.startsWith(`${DASHBOARD_PATH}/`)

    if (url.origin !== APP_ORIGIN || !isDashboardPath) {
      return fallback
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export function buildPersonaManagementHref(returnTo: string): string {
  const params = new URLSearchParams({
    returnTo: resolveDashboardReturnPath(returnTo),
  })

  return `/dashboard/personas?${params.toString()}`
}
