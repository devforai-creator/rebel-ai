import useSWR from 'swr'
import type { ChatOptionsResponse } from '@/lib/chat-options/contracts'

const fetcher = async (url: string): Promise<ChatOptionsResponse> => {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('Failed to load chat options')
  }
  return response.json()
}

export function useChatOptions(enabled: boolean) {
  return useSWR<ChatOptionsResponse>(enabled ? '/api/chat-options' : null, fetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  })
}
