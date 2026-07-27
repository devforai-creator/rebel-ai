import { describe, expect, it } from 'vitest'
import { getDefaultModelForProvider, listUiModelIdsByProvider } from '@/lib/models'
import {
  buildLlmModelOptions,
  isSameLlmModelSelection,
  parseLlmModelSelection,
  resolveLlmModelSelection,
  serializeLlmModelSelection,
  type LlmCredentialOption,
} from './model-selection'

const openaiCredential = {
  id: 'openai-key',
  provider: 'openai',
  model_preference: null,
} satisfies LlmCredentialOption

describe('LLM model selection', () => {
  it('expands one provider credential into every UI model for that provider', () => {
    const options = buildLlmModelOptions([openaiCredential])

    expect(options.map((option) => option.modelName)).toEqual(listUiModelIdsByProvider('openai'))
    expect(new Set(options.map((option) => option.credential.id))).toEqual(new Set(['openai-key']))
  })

  it('uses an explicit model when it belongs to the credential provider', () => {
    const modelName = listUiModelIdsByProvider('openai')[1]

    expect(
      resolveLlmModelSelection({
        credentials: [openaiCredential],
        apiKeyId: openaiCredential.id,
        modelName,
      }),
    ).toEqual({
      apiKeyId: openaiCredential.id,
      modelName,
    })
  })

  it('falls back from an unavailable model to the credential preference', () => {
    const modelPreference = listUiModelIdsByProvider('openai')[1]
    const credential = {
      ...openaiCredential,
      model_preference: modelPreference,
    }

    expect(
      resolveLlmModelSelection({
        credentials: [credential],
        apiKeyId: credential.id,
        modelName: 'anthropic-only-model',
      }),
    ).toEqual({
      apiKeyId: credential.id,
      modelName: modelPreference,
    })
  })

  it('uses the provider default when no explicit or legacy preference exists', () => {
    expect(
      resolveLlmModelSelection({
        credentials: [openaiCredential],
        apiKeyId: openaiCredential.id,
      }),
    ).toEqual({
      apiKeyId: openaiCredential.id,
      modelName: getDefaultModelForProvider('openai'),
    })
  })

  it('round-trips a selection value and compares the complete pair', () => {
    const selection = {
      apiKeyId: 'key-1',
      modelName: 'provider/model:version',
    }

    expect(parseLlmModelSelection(serializeLlmModelSelection(selection))).toEqual(selection)
    expect(isSameLlmModelSelection(selection, { ...selection })).toBe(true)
    expect(
      isSameLlmModelSelection(selection, {
        ...selection,
        modelName: 'another-model',
      }),
    ).toBe(false)
  })
})
