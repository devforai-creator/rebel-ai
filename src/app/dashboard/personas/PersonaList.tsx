'use client'

import { useState, useTransition } from 'react'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import { runConfirmedAction } from '@/app/dashboard/components/confirm-action'
import type { Persona } from '@/types/database.types'
import { MAX_PERSONA_DESCRIPTION_LENGTH, MAX_PERSONA_NAME_LENGTH } from '@/lib/personas/constants'
import { createPersona, updatePersona, deletePersona } from './actions'
import { Plus, Edit2, Trash2, X, Check } from 'lucide-react'

export type PersonaListItem = Pick<Persona, 'id' | 'name' | 'description' | 'created_at'>

interface Props {
  initialPersonas: PersonaListItem[]
}

export default function PersonaList({ initialPersonas }: Props) {
  const [personas, setPersonas] = useState<PersonaListItem[]>(initialPersonas)
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState({ name: '', description: '' })
  const [editFormData, setEditFormData] = useState({ name: '', description: '' })

  const handleCreate = () => {
    if (!formData.name.trim()) {
      setError('Please enter a persona name')
      return
    }

    startTransition(async () => {
      const result = await createPersona({
        name: formData.name,
        description: formData.description || undefined,
      })

      if (result.error) {
        setError(result.error)
      } else if (result.persona) {
        setPersonas([result.persona, ...personas])
        setFormData({ name: '', description: '' })
        setIsCreating(false)
        setError(null)
      }
    })
  }

  const handleEdit = (persona: PersonaListItem) => {
    setEditingId(persona.id)
    setEditFormData({ name: persona.name, description: persona.description || '' })
    setIsCreating(false)
  }

  const handleUpdate = (personaId: string) => {
    if (!editFormData.name.trim()) {
      setError('Please enter a persona name')
      return
    }

    startTransition(async () => {
      const result = await updatePersona(personaId, {
        name: editFormData.name,
        description: editFormData.description || null,
      })

      if (result.error) {
        setError(result.error)
      } else if (result.persona) {
        setPersonas(personas.map((p) => (p.id === personaId ? { ...p, ...result.persona } : p)))
        setEditingId(null)
        setError(null)
      }
    })
  }

  const handleDelete = (personaId: string) => {
    setPendingDeleteId(personaId)
  }

  const confirmDelete = () => {
    const targetId = pendingDeleteId
    setPendingDeleteId(null)

    void runConfirmedAction(targetId, async (personaId) => {
      startTransition(async () => {
        const result = await deletePersona(personaId)

        if (result.error) {
          setError(result.error)
        } else {
          setPersonas(personas.filter((p) => p.id !== personaId))
          setError(null)
        }
      })
    })
  }

  return (
    <div className="space-y-6">
      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Create New Persona Button */}
      {!isCreating && !editingId && (
        <button
          onClick={() => {
            setIsCreating(true)
            setError(null)
          }}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
          disabled={isPending}
        >
          <Plus className="w-5 h-5" />
          Create New Persona
        </button>
      )}

      {/* Create Form */}
      {isCreating && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Create New Persona
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Persona Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Student Mode, Office Worker"
                maxLength={MAX_PERSONA_NAME_LENGTH}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {formData.name.length}/{MAX_PERSONA_NAME_LENGTH}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Persona Description (optional)
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter just the name, or freely write age/gender/appearance/personality/background..."
                rows={6}
                maxLength={MAX_PERSONA_DESCRIPTION_LENGTH}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {formData.description.length}/{MAX_PERSONA_DESCRIPTION_LENGTH}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={isPending}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                Create
              </button>
              <button
                onClick={() => {
                  setIsCreating(false)
                  setFormData({ name: '', description: '' })
                  setError(null)
                }}
                disabled={isPending}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Personas List */}
      <div className="space-y-4">
        {personas.length === 0 && !isCreating && (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400">
              No personas yet. Create a new persona!
            </p>
          </div>
        )}

        {personas.map((persona) => (
          <div
            key={persona.id}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6"
          >
            {editingId === persona.id ? (
              // Edit Mode
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Persona Name
                  </label>
                  <input
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    maxLength={MAX_PERSONA_NAME_LENGTH}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {editFormData.name.length}/{MAX_PERSONA_NAME_LENGTH}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Persona Description (optional)
                  </label>
                  <textarea
                    value={editFormData.description}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, description: e.target.value })
                    }
                    rows={6}
                    maxLength={MAX_PERSONA_DESCRIPTION_LENGTH}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {editFormData.description.length}/{MAX_PERSONA_DESCRIPTION_LENGTH}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdate(persona.id)}
                    disabled={isPending}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null)
                      setError(null)
                    }}
                    disabled={isPending}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              // View Mode
              <>
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {persona.name}
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(persona)}
                      disabled={isPending}
                      className="p-2 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(persona.id)}
                      disabled={isPending}
                      className="p-2 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {persona.description ? (
                  <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {persona.description}
                  </p>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400 italic">(Name only)</p>
                )}

                <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
                  Created:{' '}
                  {persona.created_at
                    ? new Date(persona.created_at).toLocaleDateString('en-US')
                    : 'Unknown'}
                </p>
              </>
            )}
          </div>
        ))}
      </div>

      <ConfirmDialog
        isOpen={pendingDeleteId !== null}
        title="Delete persona?"
        description="This removes the saved persona from your account."
        confirmLabel="Delete persona"
        isConfirming={isPending && pendingDeleteId !== null}
        onConfirm={confirmDelete}
        onClose={() => setPendingDeleteId(null)}
      />
    </div>
  )
}
