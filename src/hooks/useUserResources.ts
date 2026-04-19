import useSWR from 'swr'
import { createApiError } from '@/lib/http/api-contract'

const fetchModules = async (url: string) => {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw await createApiError(response, 'Failed to load modules')
  }
  const data = await response.json()
  return Array.isArray(data.modules) ? data.modules : []
}

export interface ModuleOption {
  id: string
  name: string
}

type FetchOptions = {
  enabled?: boolean
}

export function useUserModules(initialData: ModuleOption[], options?: FetchOptions) {
  const enabled = options?.enabled ?? true
  const { data, error, isLoading, mutate } = useSWR<ModuleOption[]>(
    enabled ? '/api/modules' : null,
    fetchModules,
    {
      fallbackData: enabled ? initialData : [],
      revalidateOnFocus: false,
    },
  )

  return {
    modules: enabled ? (data ?? initialData) : initialData,
    isLoading: enabled ? isLoading : false,
    error: enabled ? error : undefined,
    refresh: () => {
      if (enabled) {
        void mutate()
      }
    },
  }
}
