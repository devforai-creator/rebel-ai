import type { Provider } from '@/types/database.types'
import { getDefaultModelForProvider as resolveDefaultModel } from '@/lib/models'

export function getDefaultModelForProvider(provider: string): string {
  return resolveDefaultModel(provider as Provider)
}
