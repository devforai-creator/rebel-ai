import type { Character } from '@/types/database.types'

export type CharacterGreetingSource = Pick<Character, 'greeting_message' | 'metadata'>

export function getCharacterGreetingOptions(
  character: CharacterGreetingSource,
): Array<string | null> {
  const greetings: Array<string | null> = []

  if (character.greeting_message) {
    greetings.push(character.greeting_message)
  }

  const metadata = character.metadata
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    'alternate_greetings' in metadata &&
    Array.isArray(metadata.alternate_greetings)
  ) {
    for (const greeting of metadata.alternate_greetings) {
      if (typeof greeting === 'string') {
        greetings.push(greeting)
      }
    }
  }

  if (greetings.length > 0) {
    greetings.push(null)
  }

  return greetings
}
