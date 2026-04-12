'use client'

import React, { useState } from 'react'
import Button from '@/app/dashboard/components/Button'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import { createCharacter, updateCharacter } from './actions'
import { submitCharacterForm, toggleSelectedModuleIds } from './character-ui-logic'
import type { Character } from '@/types/database.types'
import { useUserModules } from '@/hooks/useUserResources'

interface Module {
  id: string
  name: string
}

export type EditableCharacterFields = Pick<
  Character,
  'id' | 'name' | 'description' | 'system_prompt' | 'greeting_message'
>

interface Props {
  character?: EditableCharacterFields
  modules?: Module[]
  initialModuleIds?: string[]
  showResourceSelectors?: boolean
}

// Users can directly edit fields or import RBX packages

// Default values as constants to prevent new references on every render
const EMPTY_ARRAY: string[] = []

export default function CharacterForm({
  character,
  modules = [],
  initialModuleIds = EMPTY_ARRAY,
  showResourceSelectors = true,
}: Props) {
  const isEditing = !!character
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>(() => initialModuleIds)

  const { modules: moduleOptions } = useUserModules(modules, {
    enabled: showResourceSelectors,
  })

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)

    const result = await submitCharacterForm({
      characterId: character?.id,
      formData,
      isEditing,
      selectedModuleIds,
      createCharacterImpl: createCharacter,
      updateCharacterImpl: updateCharacter,
    })

    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
    // 성공 시 redirect가 자동으로 처리됨
  }

  function toggleModule(moduleId: string) {
    setSelectedModuleIds((prev) => toggleSelectedModuleIds(prev, moduleId))
  }

  return (
    <SurfaceCard padding="none" className="p-8">
      {/* 폼 */}
      <form id="character-form" action={handleSubmit} className="space-y-6">
        {error && <InlineFeedback tone="error">{error}</InlineFeedback>}

        {/* 이름 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            이름 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="name"
            required
            defaultValue={character?.name}
            placeholder="예: Alice / 판타지 주점 시뮬레이션"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
        </div>

        {/* 설명 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            설명
          </label>
          <textarea
            name="description"
            rows={2}
            defaultValue={character?.description || ''}
            placeholder="캐릭터 또는 시뮬레이션에 대한 간단한 설명"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white resize-none"
          />
        </div>

        {/* 시스템 프롬프트 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            시스템 프롬프트 <span className="text-red-500">*</span>
          </label>
          <textarea
            name="system_prompt"
            rows={12}
            required
            defaultValue={character?.system_prompt}
            placeholder="캐릭터의 페르소나, 말투, 배경 등을 자유롭게 작성하세요.&#10;또는 시뮬레이션의 세계관, 등장 캐릭터, 규칙 등을 작성하세요."
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white font-mono text-sm"
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            AI에게 전달되는 핵심 지시사항입니다. 구체적으로 작성할수록 좋습니다.
          </p>
        </div>

        {/* 첫 인사말 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            첫 인사말 (선택)
          </label>
          <textarea
            name="greeting_message"
            rows={3}
            defaultValue={character?.greeting_message || ''}
            placeholder="대화 시작 시 AI가 먼저 할 말 (비워두면 사용자가 먼저 시작)"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white resize-none"
          />
        </div>

        {/* 모듈 선택 (선택 사항) */}
        {showResourceSelectors && (
          <>
            <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  확장 모듈 (선택)
                </label>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  외부 업로드는 현재 비활성화되어 있습니다.
                </span>
              </div>
              {moduleOptions.length > 0 ? (
                <div className="space-y-2">
                  {moduleOptions.map((mod) => (
                    <label
                      key={mod.id}
                      className="flex items-center gap-2 p-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedModuleIds.includes(mod.id)}
                        onChange={() => toggleModule(mod.id)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <span className="text-sm text-gray-900 dark:text-white">{mod.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <SurfaceCard
                  tone="dashed"
                  padding="sm"
                  className="text-sm text-gray-500 dark:text-gray-400 shadow-none"
                >
                  사용 가능한 모듈이 없습니다.
                </SurfaceCard>
              )}
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                모듈을 선택하면 로어북, extract regex, UI 카드 보조 데이터가 함께 적용됩니다.
              </p>
            </div>
          </>
        )}

        {/* 제출 버튼 */}
        <div className="flex gap-4">
          <Button type="submit" disabled={loading} size="lg" fullWidth className="flex-1">
            {loading
              ? isEditing
                ? '수정 중...'
                : '생성 중...'
              : isEditing
                ? '캐릭터 수정'
                : '캐릭터 생성'}
          </Button>
        </div>
      </form>
    </SurfaceCard>
  )
}
