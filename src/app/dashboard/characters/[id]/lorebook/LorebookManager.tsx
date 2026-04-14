'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, ChevronDown, Folder, FileText, Edit, Trash2 } from 'lucide-react'
import { groupLorebookByFolder } from '@/lib/lorebook-renderer'
import type { LorebookEntry } from '@/types/risuai.types'
import { updateLorebookEntryAlwaysActive } from './actions'
import {
  buildCharacterLorebookEntries,
  type CharacterLorebookEntry,
  type CharacterModuleWithLorebook,
} from './lorebook-data'

interface LorebookManagerProps {
  characterId: string
  characterModules: CharacterModuleWithLorebook[]
}

export default function LorebookManager({ characterId, characterModules }: LorebookManagerProps) {
  const router = useRouter()
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['__root__']))
  const [editingEntry, setEditingEntry] = useState<string | null>(null)

  const allEntries = buildCharacterLorebookEntries(characterModules)

  const getLorebookCount = (lorebook: LorebookEntry[]): number => lorebook.length

  // Group by folder
  const folderMap = groupLorebookByFolder(allEntries)

  const toggleFolder = (folderKey: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderKey)) {
        next.delete(folderKey)
      } else {
        next.add(folderKey)
      }
      return next
    })
  }

  // If no modules, show empty state
  if (characterModules.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">이 캐릭터에 연결된 모듈이 없습니다.</p>
        <p className="text-xs text-muted-foreground mt-2">
          RBX 패키지에 연결된 모듈이 있으면 여기에서 로어북 항목을 확인할 수 있습니다.
        </p>
      </div>
    )
  }

  if (allEntries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">로어북 항목이 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Module list */}
      <div className="rounded-lg border p-4">
        <h3 className="font-medium mb-3">연결된 모듈</h3>
        <div className="space-y-2">
          {characterModules.map((cm) => (
            <div
              key={cm.id}
              className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <div
                  className={`h-2 w-2 rounded-full ${cm.enabled ? 'bg-green-500' : 'bg-gray-400'}`}
                />
                <span>{cm.modules?.name ?? 'Unknown Module'}</span>
                <span className="text-xs text-muted-foreground">
                  ({getLorebookCount(cm.modules?.lorebook ?? [])}개 항목)
                </span>
              </div>
              <span className="text-xs text-muted-foreground">우선순위: {cm.priority}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Lorebook tree */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/50 px-4 py-3">
          <h3 className="font-medium">로어북 항목 ({allEntries.length})</h3>
          <p className="text-xs text-muted-foreground mt-1">
            폴더를 클릭하여 항목을 확장/축소합니다
          </p>
        </div>

        <div className="p-2">
          {Array.from(folderMap.entries()).map(([folderKey, entries]) => {
            const isExpanded = expandedFolders.has(folderKey)
            const folderName = folderKey === '__root__' ? '📁 루트 폴더' : folderKey
            const folderEntry = allEntries.find((e) => e.mode === 'folder' && e.key === folderKey)
            const displayName = folderEntry?.comment || folderName

            return (
              <div key={folderKey} className="mb-2">
                {/* Folder header */}
                <button
                  onClick={() => toggleFolder(folderKey)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Folder className="h-4 w-4 text-yellow-600" />
                  <span className="font-medium">{displayName}</span>
                  <span className="text-xs text-muted-foreground">({entries.length})</span>
                </button>

                {/* Folder contents */}
                {isExpanded && (
                  <div className="ml-6 mt-1 space-y-1">
                    {entries.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">비어있음</div>
                    ) : (
                      entries.map((entry, idx) => {
                        const uniqueKey = `${folderKey}-${idx}-${entry.key}-${entry.insertorder}`
                        return (
                          <LorebookEntryRow
                            key={uniqueKey}
                            characterId={characterId}
                            entry={entry}
                            isEditing={editingEntry === uniqueKey}
                            onEdit={() => setEditingEntry(uniqueKey)}
                            onCancelEdit={() => setEditingEntry(null)}
                            onToggleSuccess={() => router.refresh()}
                          />
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Statistics */}
      <div className="rounded-lg border p-4">
        <h3 className="font-medium mb-2">통계</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">전체 항목</div>
            <div className="text-2xl font-bold">{allEntries.length}</div>
          </div>
          <div>
            <div className="text-muted-foreground">항상 활성화</div>
            <div className="text-2xl font-bold">
              {allEntries.filter((e) => e.alwaysActive).length}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">키워드 활성화</div>
            <div className="text-2xl font-bold">
              {allEntries.filter((e) => e.key && !e.alwaysActive).length}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface LorebookEntryRowProps {
  characterId: string
  entry: CharacterLorebookEntry
  isEditing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onToggleSuccess?: () => void
}

function LorebookEntryRow({
  characterId,
  entry,
  isEditing,
  onEdit,
  onCancelEdit,
  onToggleSuccess,
}: LorebookEntryRowProps) {
  // Initialize with alwaysActive state, but allow user to toggle
  const [isEnabled, setIsEnabled] = useState(entry.alwaysActive || false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (isEditing) {
    return (
      <div className="rounded-md border bg-background p-3 space-y-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">키워드 (쉼표로 구분)</label>
          <input
            type="text"
            defaultValue={entry.key}
            className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
            readOnly
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">내용</label>
          <textarea
            defaultValue={entry.content}
            rows={4}
            className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
            readOnly
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancelEdit}
            className="rounded-md bg-muted px-3 py-1 text-xs hover:bg-muted/80"
          >
            닫기
          </button>
        </div>
        <div className="text-xs text-muted-foreground">
          현재 버전에서는 로어북 편집이 지원되지 않습니다. 원본 RBX 패키지 또는 연결된 모듈을 수정한
          뒤 다시 가져와 주세요.
        </div>
      </div>
    )
  }

  const handleToggle = async (checked: boolean) => {
    setErrorMessage(null)
    setIsEnabled(checked)
    setIsSaving(true)

    try {
      const result = await updateLorebookEntryAlwaysActive({
        characterId,
        moduleId: entry.moduleId,
        entryKey: entry.key,
        entryInsertorder: entry.insertorder ?? 0,
        enabled: checked,
      })

      if (result?.error) {
        setIsEnabled(!checked)
        setErrorMessage(result.error)
        return
      }

      onToggleSuccess?.()
    } catch (error) {
      console.error('[Lorebook] Failed to update entry', error)
      setIsEnabled(!checked)
      setErrorMessage('저장하지 못했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className={`group flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors ${
        !isEnabled ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <input
          type="checkbox"
          checked={isEnabled}
          disabled={isSaving}
          onChange={(e) => {
            void handleToggle(e.target.checked)
          }}
          className="h-4 w-4 rounded border-gray-300 disabled:opacity-50"
          title={isEnabled ? '항상 활성화 항목 (토글 가능)' : '키워드 활성화 항목'}
        />
        <FileText className="h-4 w-4 text-blue-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm truncate">{entry.key}</span>
            {isEnabled && (
              <span className="text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded">
                항상 활성화
              </span>
            )}
            <span className="text-xs text-muted-foreground truncate">{entry.moduleName}</span>
          </div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {entry.content.substring(0, 80)}
            {entry.content.length > 80 ? '...' : ''}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="rounded-md p-1 hover:bg-muted" title="상세 보기">
          <Edit className="h-3.5 w-3.5" />
        </button>
        <button
          className="rounded-md p-1 hover:bg-muted text-red-600"
          title="삭제 (비활성화됨)"
          disabled
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {errorMessage && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
      )}
    </div>
  )
}
