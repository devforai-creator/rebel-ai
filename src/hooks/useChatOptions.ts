import useSWR from 'swr'

export interface ApiKey {
  id: string
  key_name: string
  provider: string
  model_preference: string | null
}

export interface Persona {
  id: string
  name: string
  description: string | null
}

export interface ChatOptions {
  apiKeys: ApiKey[]
  personas: Persona[]
}

const fetcher = async (url: string): Promise<ChatOptions> => {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('Failed to load chat options')
  }
  return response.json()
}

export function useChatOptions(enabled: boolean) {
  return useSWR<ChatOptions>(enabled ? '/api/chat-options' : null, fetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  })
}
