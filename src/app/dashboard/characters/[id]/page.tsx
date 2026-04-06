import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import CharacterDetailContent from './CharacterDetailContent'

const CHARACTER_DETAIL_FIELDS = `
  id,
  user_id,
  name,
  description,
  system_prompt,
  greeting_message,
  avatar_url,
  visibility,
  created_at
`

interface Props {
  params: Promise<{ id: string }>
}

export default async function CharacterDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // 캐릭터 정보 가져오기 (본인 캐릭터 or 스타터)
  const { data: character, error } = await supabase
    .from('characters')
    .select(CHARACTER_DETAIL_FIELDS)
    .eq('id', id)
    .or(`user_id.eq.${user.id},user_id.is.null`)
    .is('archived_at', null)
    .single()

  if (error || !character) {
    redirect('/dashboard/characters')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* 헤더 */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/characters"
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              ← 캐릭터 목록
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{character.name}</h1>
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Suspense fallback={<CharacterDetailFallback />}>
          <CharacterDetailContent character={character} userId={user.id} />
        </Suspense>
      </main>
    </div>
  )
}

function CharacterDetailFallback() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse">
      <div className="h-96 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800" />
      <div className="lg:col-span-2 h-[32rem] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800" />
    </div>
  )
}
