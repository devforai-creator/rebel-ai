'use client'

import React from 'react'
import Link from 'next/link'
import { buttonClassName } from '@/app/dashboard/components/Button'

interface Props {
  characterId: string
}

export default function NewChatButton({ characterId }: Props) {
  return (
    <Link href={`/dashboard/chats/new?character=${characterId}`} className={buttonClassName()}>
      + 새 채팅 시작
    </Link>
  )
}
