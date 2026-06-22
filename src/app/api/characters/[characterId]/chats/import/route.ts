import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { importChatForUser } from '@/lib/chat/import-service'

const CHAT_IMPORT_FILE_FIELD = 'file'
const CHAT_IMPORT_TITLE_FIELD = 'title'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ characterId: string }> },
) {
  const { characterId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid import request' }, { status: 400 })
  }

  const file = formData.get(CHAT_IMPORT_FILE_FIELD)
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'Please select a file' }, { status: 400 })
  }

  let jsonContent: string
  try {
    jsonContent = await file.text()
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to read file' }, { status: 400 })
  }

  const rawTitle = formData.get(CHAT_IMPORT_TITLE_FIELD)
  const chatTitle = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : undefined

  const result = await importChatForUser({
    supabase,
    userId: user.id,
    characterId,
    jsonContent,
    chatTitle,
  })

  return NextResponse.json(result, { status: result.success ? 200 : 400 })
}
