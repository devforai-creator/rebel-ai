import React from 'react'
import ChatPersonaEditDialog from './ChatPersonaEditDialog'
import ChatPersonaSelectDialog from './ChatPersonaSelectDialog'
import type { PersonaOption } from './chat-persona-types'

interface Props {
  chatId: string
  personaId: string | null
  initialName: string | null
  initialDescription: string | null
  availablePersonas: PersonaOption[]
  asMenuItem?: boolean
}

export default function ChatPersonaWidget({
  chatId,
  personaId,
  initialName,
  initialDescription,
  availablePersonas,
  asMenuItem = false,
}: Props) {
  return (
    <>
      <ChatPersonaSelectDialog
        chatId={chatId}
        currentPersonaId={personaId}
        currentPersonaName={initialName}
        availablePersonas={availablePersonas}
        asMenuItem={asMenuItem}
      />
      {personaId ? (
        <ChatPersonaEditDialog
          personaId={personaId}
          initialName={initialName}
          initialDescription={initialDescription}
          asMenuItem={asMenuItem}
        />
      ) : null}
    </>
  )
}
