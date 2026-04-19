import type { Persona, Provider } from '@/types/database.types'

export type ChatOptionsApiKey = {
  id: string
  key_name: string
  provider: Provider
  model_preference: string | null
}

export type ChatOptionsPersona = Pick<Persona, 'id' | 'name' | 'description'>

export type ChatOptionsResponse = {
  apiKeys: ChatOptionsApiKey[]
  personas: ChatOptionsPersona[]
}
