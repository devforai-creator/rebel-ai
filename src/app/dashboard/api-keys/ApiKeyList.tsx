'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/app/dashboard/components/Button'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import { runConfirmedAction } from '@/app/dashboard/components/confirm-action'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import type { ApiKey } from '@/types/database.types'
import { PROVIDER_CATALOG } from '@/lib/providers/catalog'
import { deleteApiKey, toggleApiKey } from './actions'

interface Props {
  apiKeys: ApiKeyListItem[]
}

type ApiKeyListItem = Omit<ApiKey, 'vault_secret_name' | 'user_id'>

export default function ApiKeyList({ apiKeys }: Props) {
  const router = useRouter()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    setPendingDeleteId(id)
  }

  async function confirmDelete() {
    const targetId = pendingDeleteId
    setPendingDeleteId(null)

    await runConfirmedAction(targetId, async (id) => {
      setDeletingId(id)
      const result = await deleteApiKey(id)
      setDeletingId(null)

      if (result?.error) {
        toast.error(result.error)
        return
      }

      router.refresh()
    })
  }

  async function handleToggle(id: string, isActive: boolean) {
    const result = await toggleApiKey(id, isActive)

    if (result?.error) {
      toast.error(result.error)
      return
    }

    router.refresh()
  }

  return (
    <div className="space-y-4">
      {apiKeys.map((key) => (
        <SurfaceCard key={key.id} className="transition-colors">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              {/* Header */}
              <div className="flex items-center gap-2 mb-2">
                {PROVIDER_CATALOG[key.provider] && (
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded ${
                      PROVIDER_CATALOG[key.provider].badgeColor ??
                      'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {PROVIDER_CATALOG[key.provider].badgeLabel ?? key.provider}
                  </span>
                )}
                {key.provider === 'openai' && key.service_tier && (
                  <span className="px-2 py-1 text-xs font-medium rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
                    {key.service_tier === 'standard'
                      ? 'Standard'
                      : key.service_tier.charAt(0).toUpperCase() + key.service_tier.slice(1)}
                  </span>
                )}
                {key.provider === 'openai' && key.reasoning_effort && (
                  <span className="px-2 py-1 text-xs font-medium rounded bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                    Reasoning:{' '}
                    {key.reasoning_effort.charAt(0).toUpperCase() + key.reasoning_effort.slice(1)}
                  </span>
                )}
                <span
                  className={`px-2 py-1 text-xs font-medium rounded ${
                    key.is_active
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                  }`}
                >
                  {key.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Key Name */}
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{key.key_name}</h3>

              {/* Model */}
              {key.model_preference && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Model: {key.model_preference}
                </p>
              )}

              {/* Metadata */}
              <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                <span>Created: {new Date(key.created_at).toLocaleDateString('ko-KR')}</span>
                {key.last_used_at && (
                  <span>Last used: {new Date(key.last_used_at).toLocaleDateString('ko-KR')}</span>
                )}
              </div>

              {/* Notes */}
              {key.usage_notes && (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 italic">
                  {key.usage_notes}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 ml-4">
              <Button
                onClick={() => handleToggle(key.id, key.is_active)}
                variant="secondary"
                size="sm"
              >
                {key.is_active ? 'Deactivate' : 'Activate'}
              </Button>
              <Button
                onClick={() => handleDelete(key.id)}
                disabled={deletingId === key.id}
                variant="destructive"
                size="sm"
              >
                {deletingId === key.id ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </SurfaceCard>
      ))}

      <ConfirmDialog
        isOpen={pendingDeleteId !== null}
        title="Delete API key?"
        description="Deleting this key removes the saved provider credential from your account."
        confirmLabel="Delete key"
        isConfirming={pendingDeleteId !== null && deletingId === pendingDeleteId}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDeleteId(null)}
      />
    </div>
  )
}
