import { getDefaultModelForProvider, listModelsByProvider } from '@/lib/models'
import type { LlmProvider } from '@/types/database.types'

export type LlmCredentialOption = {
  id: string
  provider: LlmProvider
  model_preference: string | null
}

export type LlmModelSelection = {
  apiKeyId: string
  modelName: string
}

export type LlmModelOption<TCredential extends LlmCredentialOption = LlmCredentialOption> = {
  credential: TCredential
  modelName: string
  displayName: string
  value: string
}

function findUiModelName(provider: LlmProvider, candidate?: string | null): string | null {
  const normalizedCandidate = candidate?.trim().toLowerCase()
  if (!normalizedCandidate) {
    return null
  }

  return (
    listModelsByProvider(provider, { uiOnly: true }).find(
      (model) => model.id.toLowerCase() === normalizedCandidate,
    )?.id ?? null
  )
}

export function serializeLlmModelSelection(selection: LlmModelSelection): string {
  return JSON.stringify([selection.apiKeyId, selection.modelName])
}

export function parseLlmModelSelection(value: string): LlmModelSelection | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      !parsed[0] ||
      typeof parsed[1] !== 'string' ||
      !parsed[1]
    ) {
      return null
    }

    return {
      apiKeyId: parsed[0],
      modelName: parsed[1],
    }
  } catch {
    return null
  }
}

export function isSameLlmModelSelection(
  first: LlmModelSelection | null | undefined,
  second: LlmModelSelection | null | undefined,
): boolean {
  return (
    !!first &&
    !!second &&
    first.apiKeyId === second.apiKeyId &&
    first.modelName === second.modelName
  )
}

export function resolveLlmModelSelection<TCredential extends LlmCredentialOption>({
  credentials,
  apiKeyId,
  modelName,
}: {
  credentials: TCredential[]
  apiKeyId?: string | null
  modelName?: string | null
}): LlmModelSelection | null {
  const credential = credentials.find((candidate) => candidate.id === apiKeyId)
  if (!credential) {
    return null
  }

  const resolvedModelName =
    findUiModelName(credential.provider, modelName) ??
    findUiModelName(credential.provider, credential.model_preference) ??
    findUiModelName(credential.provider, getDefaultModelForProvider(credential.provider)) ??
    listModelsByProvider(credential.provider, { uiOnly: true })[0]?.id ??
    null

  return resolvedModelName
    ? {
        apiKeyId: credential.id,
        modelName: resolvedModelName,
      }
    : null
}

export function buildLlmModelOptions<TCredential extends LlmCredentialOption>(
  credentials: TCredential[],
): LlmModelOption<TCredential>[] {
  return credentials.flatMap((credential) =>
    listModelsByProvider(credential.provider, { uiOnly: true }).map((model) => {
      const selection = {
        apiKeyId: credential.id,
        modelName: model.id,
      }

      return {
        credential,
        modelName: model.id,
        displayName: model.displayName,
        value: serializeLlmModelSelection(selection),
      }
    }),
  )
}
