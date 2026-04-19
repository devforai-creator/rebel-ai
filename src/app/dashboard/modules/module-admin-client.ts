import { readApiErrorMessage } from '@/lib/http/api-contract'

export type ModuleSummary = {
  id: string
  name: string
  description?: string | null
  source_file?: string | null
  hide_icon?: boolean | null
  created_at?: string
  updated_at?: string
  counts?: {
    lorebook: number
    regex: number
    assets: number
  }
}

export async function listModules(fetchImpl: typeof fetch = fetch): Promise<ModuleSummary[]> {
  const response = await fetchImpl('/api/modules', { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load module list.'))
  }

  const payload = (await response.json()) as { modules?: unknown }
  return Array.isArray(payload?.modules) ? (payload.modules as ModuleSummary[]) : []
}

export async function deleteModule(
  moduleId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ warning?: string }> {
  const response = await fetchImpl(`/api/modules?id=${encodeURIComponent(moduleId)}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to delete module.'))
  }

  const payload = (await response.json().catch(() => null)) as { warning?: unknown } | null

  return {
    warning: typeof payload?.warning === 'string' ? payload.warning : undefined,
  }
}
