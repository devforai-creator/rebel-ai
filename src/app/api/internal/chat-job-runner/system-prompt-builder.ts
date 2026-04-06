export type RunnerCharacter = {
  id: string
  name: string
  system_prompt: string
  post_history_instructions?: string | null
}

type PersonaInfo = { name: string; description: string | null } | null

type BuildSystemPromptArgs = {
  character: RunnerCharacter
  persona: PersonaInfo
  defaultSystemPrompt: string
  customSystemPrompt?: string | null
}

function formatPersonaInfo(persona: { name: string; description: string | null }): string {
  const nameLine = `Your name is: ${persona.name}`
  const description = persona.description?.trim()
  if (!description) return nameLine
  return `${nameLine}\n\n${description}`
}

export async function buildSystemPrompt({
  character,
  persona,
  defaultSystemPrompt,
  customSystemPrompt,
}: BuildSystemPromptArgs): Promise<string> {
  const trimmedCustomSystemPrompt =
    typeof customSystemPrompt === 'string' ? customSystemPrompt.trim() : ''
  const trimmedDefaultSystemPrompt = defaultSystemPrompt.trim()
  const baseSystemPrompt =
    trimmedCustomSystemPrompt.length > 0 ? trimmedCustomSystemPrompt : trimmedDefaultSystemPrompt
  const postHistoryInstructions =
    typeof character.post_history_instructions === 'string'
      ? character.post_history_instructions.trim()
      : ''
  const characterPrompt = character.system_prompt?.trim() ?? ''

  const parts: string[] = []

  // Post-CharX contract: chat generation uses only plain-text system fields.
  // Presets/modules/template runtime remain outside the active generation path.
  if (baseSystemPrompt) {
    parts.push(baseSystemPrompt)
  }

  if (postHistoryInstructions) {
    parts.push(postHistoryInstructions)
  }

  if (characterPrompt) {
    parts.push(characterPrompt)
  }

  if (persona) {
    parts.push(`[User Information]\n${formatPersonaInfo(persona)}`)
  }

  return parts.join('\n\n---\n\n')
}
