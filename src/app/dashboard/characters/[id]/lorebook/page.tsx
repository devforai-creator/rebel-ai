import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import LorebookManager from './LorebookManager'

export default async function CharacterLorebookPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Fetch character
  const { data: character, error: characterError } = await supabase
    .from('characters')
    .select('id, name, user_id')
    .eq('id', id)
    .single()

  if (characterError || !character) {
    notFound()
  }

  // Check ownership
  if (character.user_id !== user.id) {
    notFound()
  }

  // Fetch character's modules with lorebook
  const { data: characterModules } = await supabase
    .from('character_modules')
    .select(
      `
      id,
      enabled,
      priority,
      module_id,
      modules (
        id,
        name,
        lorebook
      )
    `,
    )
    .eq('character_id', character.id)
    .order('priority', { ascending: false })

  // Type assertion for Supabase join result
  type CharacterModuleRow = {
    id: string
    enabled: boolean
    priority: number
    module_id: string
    modules: {
      id: string
      name: string
      lorebook: unknown
    } | null
  }

  const typedModules = (characterModules ?? []) as unknown as CharacterModuleRow[]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* 헤더 */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link
              href={`/dashboard/characters/${character.id}`}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              ← {character.name}
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">로어북 관리</h1>
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <LorebookManager characterId={character.id} characterModules={typedModules} />
      </main>
    </div>
  )
}
