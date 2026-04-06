'use client'

import Link from 'next/link'

interface Props {
  characterId: string
}

export default function NewChatButton({ characterId }: Props) {
  return (
    <Link
      href={`/dashboard/chats/new?character=${characterId}`}
      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors inline-flex items-center justify-center"
    >
      + 새 채팅 시작
    </Link>
  )
}
