import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { resolveDashboardReturnPath } from '@/lib/navigation/dashboard-return'
import SavesManager from './SavesManager'

type Params = { character?: string; save?: string; returnTo?: string }

export default async function SavesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams
  const saveId = params.save
  if (saveId && !z.uuid().safeParse(saveId).success) notFound()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const [saves, characters, personas, selected] = await Promise.all([
    supabase
      .from('character_saves')
      .select('id, title, character_id, default_persona_id, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .order('id'),
    supabase.from('characters').select('id, name').is('archived_at', null).order('name'),
    supabase.from('personas').select('id, name').eq('user_id', user.id).order('name'),
    saveId
      ? supabase
          .from('character_saves')
          .select('*')
          .eq('id', saveId)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (saves.error || characters.error || personas.error || selected.error)
    throw new Error('세이브 정보를 불러오지 못했습니다')
  if (saveId && !selected.data) notFound()
  const returnTo = resolveDashboardReturnPath(params.returnTo)
  const characterFilter =
    params.character === 'unlinked' ||
    characters.data.some((character) => character.id === params.character)
      ? params.character
      : ''

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <Link
            href={returnTo}
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            ← 돌아가기
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-gray-900 dark:text-white">세이브 관리</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            이어갈 사건, 관계, 약속을 보관하세요. 같은 세이브로 새 채팅을 시작할 수 있습니다.
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <SavesManager
          saves={saves.data}
          selectedSave={selected.data}
          characters={characters.data}
          personas={personas.data}
          characterFilter={characterFilter ?? ''}
          returnTo={returnTo}
        />
      </main>
    </div>
  )
}
