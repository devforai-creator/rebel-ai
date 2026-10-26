'use client'

import React, { useState, useTransition, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CharacterSave } from '@/types/database.types'
import { MAX_SAVE_CONTENT_LENGTH, MAX_SAVE_TITLE_LENGTH } from '@/lib/character-saves/constants'
import { buildSaveManagementHref } from '@/lib/character-saves/navigation'
import { estimateTokenCount } from '@/lib/chat-summaries/formatters'
import { createCharacterSave, deleteCharacterSave, updateCharacterSave } from './actions'

type Option = { id: string; name: string }
type SaveSummary = Pick<
  CharacterSave,
  'id' | 'title' | 'character_id' | 'default_persona_id' | 'updated_at'
>

type Props = {
  saves: SaveSummary[]
  selectedSave: CharacterSave | null
  characters: Option[]
  personas: Option[]
  characterFilter: string
  returnTo: string
}

const fieldClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white'

export default function SavesManager(props: Props) {
  const { saves, selectedSave, characters, characterFilter, returnTo } = props
  const router = useRouter()
  const visibleSaves = saves.filter(
    (save) =>
      !characterFilter ||
      (characterFilter === 'unlinked' ? !save.character_id : save.character_id === characterFilter),
  )
  const newHref = buildSaveManagementHref({ characterId: characterFilter, returnTo })

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(240px,1fr)_minmax(0,3fr)]">
      <aside className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900 dark:text-white">내 세이브</h2>
          <Link
            href={newHref}
            className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            + 새 세이브
          </Link>
        </div>
        <label
          htmlFor="save-filter"
          className="mb-2 block text-sm text-gray-600 dark:text-gray-400"
        >
          캐릭터별 보기
        </label>
        <select
          id="save-filter"
          className={fieldClass}
          value={characterFilter}
          onChange={(event) =>
            router.push(buildSaveManagementHref({ characterId: event.target.value, returnTo }))
          }
        >
          <option value="">모든 세이브</option>
          <option value="unlinked">연결되지 않은 세이브</option>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
        <ul className="mt-4 space-y-2">
          {visibleSaves.map((save) => (
            <li key={save.id}>
              <Link
                href={buildSaveManagementHref({
                  characterId: characterFilter,
                  saveId: save.id,
                  returnTo,
                })}
                aria-current={selectedSave?.id === save.id ? 'page' : undefined}
                className={
                  'block rounded-lg border p-3 hover:border-blue-400 ' +
                  (selectedSave?.id === save.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                    : 'border-gray-200 dark:border-gray-700')
                }
              >
                <p className="break-words text-sm font-medium text-gray-900 dark:text-white">
                  {save.title}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {characters.find((character) => character.id === save.character_id)?.name ??
                    (save.character_id ? '현재 접근할 수 없는 캐릭터' : '연결되지 않음')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
        {!visibleSaves.length && (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">아직 세이브가 없습니다.</p>
        )}
      </aside>
      <SaveEditor
        key={selectedSave?.id ?? 'new-' + characterFilter}
        save={selectedSave}
        characters={props.characters}
        personas={props.personas}
        initialCharacterId={
          characters.some((character) => character.id === characterFilter) ? characterFilter : ''
        }
        returnTo={returnTo}
        characterFilter={characterFilter}
      />
    </div>
  )
}

function SaveEditor({
  save,
  characters,
  personas,
  initialCharacterId,
  characterFilter,
  returnTo,
}: {
  save: CharacterSave | null
  characters: Option[]
  personas: Option[]
  initialCharacterId: string
  characterFilter: string
  returnTo: string
}) {
  const router = useRouter()
  const [title, setTitle] = useState(save?.title ?? '')
  const [content, setContent] = useState(save?.content ?? '')
  const [characterId, setCharacterId] = useState(
    save ? (save.character_id ?? '') : initialCharacterId,
  )
  const [personaId, setPersonaId] = useState(save?.default_persona_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const hasCurrentCharacter = characters.some((character) => character.id === characterId)
  const canStart =
    save?.character_id && characters.some((character) => character.id === save.character_id)
  const newChatHref = canStart
    ? '/dashboard/chats/new?' +
      new URLSearchParams({
        character: save.character_id!,
        save: save.id,
      }).toString()
    : null

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    startTransition(async () => {
      try {
        const input = {
          title,
          content,
          characterId: characterId || null,
          defaultPersonaId: personaId || null,
        }
        if (save) {
          const result = await updateCharacterSave(save.id, input)
          if (result.error) {
            setError(result.error)
            return
          }
          setMessage('저장했습니다. 다음 답변부터 적용됩니다.')
        } else {
          const result = await createCharacterSave(input)
          if (result.error) {
            setError(result.error)
            return
          }
          router.push(
            buildSaveManagementHref({
              characterId: characterFilter,
              saveId: result.saveId,
              returnTo,
            }),
          )
        }
        router.refresh()
      } catch {
        setError('세이브를 저장하지 못했습니다. 다시 시도해주세요.')
      }
    })
  }

  function handleDelete() {
    if (!save || !window.confirm('이 세이브를 삭제할까요? 연결된 채팅은 유지됩니다.')) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await deleteCharacterSave(save.id)
        if (result.error) {
          setError(result.error)
          return
        }
        router.push(buildSaveManagementHref({ characterId: characterFilter, returnTo }))
        router.refresh()
      } catch {
        setError('세이브를 삭제하지 못했습니다. 다시 시도해주세요.')
      }
    })
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {save ? '세이브 편집' : '새 세이브'}
        </h2>
        {newChatHref && (
          <Link
            href={newChatHref}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            이 세이브로 새 채팅
          </Link>
        )}
      </div>
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm text-green-700 dark:text-green-400">
            {message}
          </p>
        )}
        <div>
          <label
            htmlFor="save-title"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            세이브 제목
          </label>
          <input
            id="save-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={MAX_SAVE_TITLE_LENGTH}
            required
            disabled={pending}
            className={fieldClass}
            placeholder="예: 첫 번째 모험"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="save-character"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              연결 캐릭터
            </label>
            <select
              id="save-character"
              value={characterId}
              onChange={(event) => setCharacterId(event.target.value)}
              disabled={pending}
              className={fieldClass}
            >
              <option value="">연결하지 않음</option>
              {characterId && !hasCurrentCharacter && (
                <option value={characterId}>현재 연결 (접근 불가)</option>
              )}
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="save-persona"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              기본 페르소나
            </label>
            <select
              id="save-persona"
              value={personaId}
              onChange={(event) => setPersonaId(event.target.value)}
              disabled={pending}
              className={fieldClass}
            >
              <option value="">페르소나 없음</option>
              {personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label
            htmlFor="save-content"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            이어갈 이야기
          </label>
          <p id="save-content-help" className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            다음 세션에도 유지할 사건, 관계, 약속을 직접 정리해주세요. 새 장면은 채팅에서
            시작하세요.
          </p>
          <textarea
            id="save-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            maxLength={MAX_SAVE_CONTENT_LENGTH}
            rows={18}
            disabled={pending}
            aria-describedby="save-content-help save-content-size"
            className={fieldClass + ' leading-relaxed'}
            placeholder="인물별 관계, 중요한 사건, 아직 남아 있는 약속 등을 적어주세요."
          />
          <p
            id="save-content-size"
            className="mt-2 text-right text-xs text-gray-500 dark:text-gray-400"
          >
            {content.length.toLocaleString()} / {MAX_SAVE_CONTENT_LENGTH.toLocaleString()}자 · 약{' '}
            {estimateTokenCount(content).toLocaleString()} 토큰 (추정)
          </p>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            본문은 연결된 채팅의 매 답변에 포함됩니다. 토큰 수는 모델과 언어에 따라 달라집니다.
            수정한 내용은 모든 연결 채팅의 다음 답변부터 적용됩니다.
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-5 dark:border-gray-700">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? '처리 중…' : '세이브 저장'}
          </button>
          {save && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              세이브 삭제
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
