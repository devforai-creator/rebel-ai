'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { deleteModule, listModules, type ModuleSummary } from './module-admin-client'

type FetchState = {
  loading: boolean
  error: string | null
}

export function useModulesAdmin() {
  const [modules, setModules] = useState<ModuleSummary[]>([])
  const [{ loading, error }, setState] = useState<FetchState>({
    loading: true,
    error: null,
  })
  const [deleting, setDeleting] = useState<string | null>(null)

  const loadModules = useCallback(async () => {
    setState({ loading: true, error: null })

    try {
      const nextModules = await listModules()
      setModules(nextModules)
      setState({ loading: false, error: null })
    } catch (err) {
      console.error('[Module Admin] Failed to load modules', err)
      setState({
        loading: false,
        error: err instanceof Error ? err.message : 'An unknown error occurred.',
      })
    }
  }, [])

  useEffect(() => {
    void loadModules()
  }, [loadModules])

  const removeModule = useCallback(async (moduleId: string) => {
    setDeleting(moduleId)

    try {
      await deleteModule(moduleId)
      setModules((prev) => prev.filter((module) => module.id !== moduleId))
    } catch (err) {
      console.error('[Module Admin] Failed to delete module', err)
      toast.error(err instanceof Error ? err.message : 'An error occurred during deletion.')
    } finally {
      setDeleting((current) => (current === moduleId ? null : current))
    }
  }, [])

  return {
    modules,
    loading,
    error,
    deleting,
    loadModules,
    removeModule,
  }
}
