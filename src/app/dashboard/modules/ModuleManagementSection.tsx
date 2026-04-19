'use client'

import { useCallback, useMemo, useState } from 'react'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import { runConfirmedAction } from '@/app/dashboard/components/confirm-action'
import { useModulesAdmin } from './useModulesAdmin'
import type { ModuleSummary } from './module-admin-client'

export default function ModuleManagementSection() {
  const { modules, loading, error, deleting, loadModules, removeModule } = useModulesAdmin()
  const [pendingDeleteModule, setPendingDeleteModule] = useState<ModuleSummary | null>(null)

  const handleDelete = useCallback(async (id: string, label: string) => {
    setPendingDeleteModule({ id, name: label })
  }, [])

  const confirmDelete = useCallback(async () => {
    const pendingModule = pendingDeleteModule
    setPendingDeleteModule(null)

    await runConfirmedAction(pendingModule, async ({ id }) => {
      await removeModule(id)
    })
  }, [pendingDeleteModule, removeModule])

  const hasModules = modules.length > 0

  const statsLabel = useCallback((module: ModuleSummary) => {
    const counts = module.counts || {
      lorebook: 0,
      regex: 0,
      assets: 0,
    }

    return `Lorebook ${counts.lorebook} · Regex ${counts.regex} · Assets ${counts.assets}`
  }, [])

  const moduleList = useMemo(() => modules, [modules])

  return (
    <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Module Management</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Review modules linked to your imported characters and delete them if needed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadModules()}
          disabled={loading}
          className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">Loading module list...</p>
      ) : error ? (
        <div className="text-sm text-red-600 dark:text-red-400">
          {error}
          <button type="button" onClick={() => void loadModules()} className="ml-2 underline">
            Retry
          </button>
        </div>
      ) : !hasModules ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No modules yet. Modules will appear here when imported characters include linked modules.
        </p>
      ) : (
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {moduleList.map((module) => (
            <div
              key={module.id}
              className="py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-base font-medium text-gray-900 dark:text-white">
                    {module.name}
                  </p>
                  {module.hide_icon ? (
                    <span className="px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
                      Icon Hidden
                    </span>
                  ) : null}
                </div>
                {module.description ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                    {module.description}
                  </p>
                ) : null}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  {statsLabel(module)}
                </p>
                {module.source_file ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    Source file: {module.source_file}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDelete(module.id, module.name)}
                  disabled={Boolean(deleting) && deleting !== module.id}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 border border-red-200 dark:border-red-700 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                >
                  {deleting === module.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={pendingDeleteModule !== null}
        title={`Delete module "${pendingDeleteModule?.name ?? ''}"?`}
        description="It will be automatically removed from connected characters."
        confirmLabel="Delete module"
        isConfirming={pendingDeleteModule !== null && deleting === pendingDeleteModule.id}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDeleteModule(null)}
      />
    </section>
  )
}
