import { useMemo } from 'react'
import type { ChatCharacter, InlineUiCardRegistry } from '../utils'

function isValidInlineUiCard(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return false
  if (!('meta' in raw) || !('views' in raw)) return false
  const views = (raw as Record<string, unknown>).views
  return typeof views === 'object' && views !== null && Object.keys(views).length > 0
}

type ResolveChatMetadataViewsArgs = {
  characterMetadata: ChatCharacter['metadata']
  runtimeVariables: Record<string, unknown>
}

export function resolveChatMetadataViews({
  characterMetadata,
  runtimeVariables,
}: ResolveChatMetadataViewsArgs) {
  const defaultVariables =
    (characterMetadata?.default_variables as Record<string, unknown> | undefined) ?? undefined
  const mergedVariables = { ...defaultVariables, ...runtimeVariables }

  const rawUiCard = characterMetadata?.ui_card as Record<string, unknown> | null | undefined
  const uiCard = isValidInlineUiCard(rawUiCard) ? rawUiCard : null

  const rawUiCardRegistry = characterMetadata?.ui_cards
  let uiCardRegistry: InlineUiCardRegistry | null = null
  if (
    rawUiCardRegistry &&
    typeof rawUiCardRegistry === 'object' &&
    !Array.isArray(rawUiCardRegistry)
  ) {
    const entries = Object.entries(rawUiCardRegistry).filter(
      ([key, value]) => key.trim().length > 0 && isValidInlineUiCard(value),
    )
    if (entries.length > 0) {
      uiCardRegistry = Object.fromEntries(entries) as InlineUiCardRegistry
    }
  }

  const rawImageDisplay = characterMetadata?.image_display as
    | Record<string, unknown>
    | null
    | undefined
  let imageDisplay: Record<string, unknown> | null = null
  if (
    rawImageDisplay &&
    typeof rawImageDisplay === 'object' &&
    rawImageDisplay.meta &&
    rawImageDisplay.views &&
    typeof rawImageDisplay.views === 'object' &&
    Object.keys(rawImageDisplay.views as Record<string, unknown>).length > 0
  ) {
    imageDisplay = rawImageDisplay
  }

  return {
    defaultVariables,
    mergedVariables,
    uiCard,
    uiCardRegistry,
    imageDisplay,
  }
}

export function useChatMetadataViews(
  character: ChatCharacter,
  runtimeVariables: Record<string, unknown>,
) {
  return useMemo(
    () =>
      resolveChatMetadataViews({
        characterMetadata: character.metadata,
        runtimeVariables,
      }),
    [character.metadata, runtimeVariables],
  )
}
