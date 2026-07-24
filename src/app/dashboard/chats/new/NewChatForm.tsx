'use client'

import React from 'react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Character, Persona } from '@/types/database.types'
import { buildPersonaManagementHref } from '@/lib/navigation/dashboard-return'
import { formatChatApiKeyOptionLabel, type ChatSelectableApiKeyOption } from '../api-key-options'
import { createChat } from '../actions'
import { getCharacterGreetingOptions } from './greeting-options'

interface Props {
  character: CharacterOption
  apiKeys: ChatSelectableApiKeyOption[]
  personas: PersonaOption[]
  initialApiKeyId?: string
  initialPersonaId?: string
  initialGreetingIndex?: number
}

type CharacterOption = Pick<Character, 'id' | 'user_id' | 'name' | 'greeting_message' | 'metadata'>
type PersonaOption = Pick<Persona, 'id' | 'name' | 'description'>

const API_KEY_SELECT_ID = 'new-chat-api-key'
const PERSONA_SELECT_ID = 'new-chat-persona'

export default function NewChatForm({
  character,
  apiKeys,
  personas,
  initialApiKeyId = '',
  initialPersonaId = '',
  initialGreetingIndex = 0,
}: Props) {
  const router = useRouter()
  const allGreetings = getCharacterGreetingOptions(character)
  const [apiKeyId, setApiKeyId] = useState(() =>
    apiKeys.some((key) => key.id === initialApiKeyId) ? initialApiKeyId : '',
  )
  const [personaId, setPersonaId] = useState(() =>
    personas.some((persona) => persona.id === initialPersonaId) ? initialPersonaId : '',
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [greetingIndex, setGreetingIndex] = useState(() =>
    Number.isInteger(initialGreetingIndex) &&
    initialGreetingIndex >= 0 &&
    initialGreetingIndex < allGreetings.length
      ? initialGreetingIndex
      : 0,
  )
  const characterId = character.id

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const result = await createChat({
        characterId,
        personaId: personaId || null,
        greetingIndex,
      })

      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }

      if (!result.chatId) {
        setError('채팅 생성에 실패했습니다')
        setLoading(false)
        return
      }

      // 채팅 페이지로 이동 (API 키 ID 전달)
      router.push(`/dashboard/chats/${result.chatId}?apiKey=${apiKeyId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '채팅 생성에 실패했습니다'
      setError(message)
      setLoading(false)
    }
  }

  const selectedApiKey = apiKeys.find((k) => k.id === apiKeyId)

  const currentGreeting =
    allGreetings[greetingIndex] !== undefined ? allGreetings[greetingIndex] : null
  const hasMultipleOptions = allGreetings.length > 1
  const returnParams = new URLSearchParams({ character: characterId })

  if (apiKeyId) {
    returnParams.set('apiKey', apiKeyId)
  }
  if (personaId) {
    returnParams.set('persona', personaId)
  }
  if (greetingIndex > 0) {
    returnParams.set('greeting', String(greetingIndex))
  }

  const personaManagementHref = buildPersonaManagementHref(
    `/dashboard/chats/new?${returnParams.toString()}`,
  )

  const handlePreviousGreeting = () => {
    setGreetingIndex((prev) => (prev > 0 ? prev - 1 : allGreetings.length - 1))
  }

  const handleNextGreeting = () => {
    setGreetingIndex((prev) => (prev < allGreetings.length - 1 ? prev + 1 : 0))
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8"
    >
      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* 캐릭터 정보 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              캐릭터
            </label>
            <Link
              href="/dashboard/characters"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              캐릭터 변경
            </Link>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <p className="text-xl font-semibold text-gray-800 dark:text-gray-100">
              {character.user_id ? character.name : `🌟 ${character.name} (추천)`}
            </p>
            {allGreetings.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    첫 인사 {hasMultipleOptions && `(${greetingIndex + 1}/${allGreetings.length})`}
                  </p>
                  {hasMultipleOptions && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={handlePreviousGreeting}
                        className="px-2 py-1 text-xs bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded hover:bg-gray-100 dark:hover:bg-gray-500 transition-colors"
                        title="이전 인사말"
                      >
                        ◀
                      </button>
                      <button
                        type="button"
                        onClick={handleNextGreeting}
                        className="px-2 py-1 text-xs bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded hover:bg-gray-100 dark:hover:bg-gray-500 transition-colors"
                        title="다음 인사말"
                      >
                        ▶
                      </button>
                    </div>
                  )}
                </div>
                {currentGreeting ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                    <span>&quot;</span>
                    {currentGreeting}
                    <span>&quot;</span>
                  </p>
                ) : (
                  <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                    (인사말 없이 시작)
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* API 키 선택 */}
        <div>
          <label
            htmlFor={API_KEY_SELECT_ID}
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            API 키 선택 <span className="text-red-500">*</span>
          </label>
          <select
            id={API_KEY_SELECT_ID}
            value={apiKeyId}
            onChange={(e) => setApiKeyId(e.target.value)}
            required
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">API 키를 선택하세요</option>
            {apiKeys.map((key) => (
              <option key={key.id} value={key.id}>
                {formatChatApiKeyOptionLabel(key, { includeModelPreference: true })}
              </option>
            ))}
          </select>

          {selectedApiKey && (
            <div className="mt-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                <strong>{selectedApiKey.provider}</strong> 제공자의 API를 사용합니다
              </p>
              {selectedApiKey.model_preference && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  모델: {selectedApiKey.model_preference}
                </p>
              )}
            </div>
          )}
        </div>

        {/* 페르소나 선택 (선택사항) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label
              htmlFor={PERSONA_SELECT_ID}
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              페르소나 선택 (선택사항)
            </label>
            <Link
              href={personaManagementHref}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              페르소나 관리
            </Link>
          </div>
          <select
            id={PERSONA_SELECT_ID}
            value={personaId}
            onChange={(e) => setPersonaId(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">페르소나 없음 (기본)</option>
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name}
              </option>
            ))}
          </select>

          {personas.length === 0 && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              페르소나를 생성하여 AI와 대화할 때 당신의 캐릭터를 설정할 수 있습니다.
            </p>
          )}

          {personaId && (
            <div className="mt-3 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
              <p className="text-sm text-purple-800 dark:text-purple-300 font-medium mb-1">
                {personas.find((p) => p.id === personaId)?.name}
              </p>
              <p className="text-xs text-purple-600 dark:text-purple-400 line-clamp-3">
                {personas.find((p) => p.id === personaId)?.description || '(이름만 설정됨)'}
              </p>
            </div>
          )}
        </div>

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={loading || !apiKeyId}
          className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? '생성 중...' : '채팅 시작'}
        </button>
      </div>
    </form>
  )
}
