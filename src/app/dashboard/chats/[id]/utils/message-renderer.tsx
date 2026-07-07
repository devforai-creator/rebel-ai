import React from 'react'
import Image from 'next/image'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import type { CharacterAsset } from '@/lib/asset-resolver'
import { collectCanonicalAssetImageTokenMatches } from '@/lib/asset-token'
import type { InlineUiCardRegistry, ModuleRegexEntry } from './types'
import { prepareMessageContentForRendering } from './message-content-pipeline'
import { UGCRenderer } from '@safe-ugc-ui/react'
import { collectExtractRegexMatches } from './extract-regex'
import { buildImageDisplayState, resolveEmotionRenderTarget } from './image-display-state'
import { buildSuuAssetMap } from './suu-asset-bridge'

const UNSUPPORTED_MARKDOWN_IMAGE_REGEX = /!\[[^\]]*]\([^)]+\)/g
const ALLOWED_MARKDOWN_ELEMENTS = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'ul',
] as const

function validateImageDisplayCard(cardJson: string): boolean {
  try {
    const card = JSON.parse(cardJson)
    if (!card || typeof card !== 'object') return false
    if (!card.views || typeof card.views !== 'object') return false
    const viewKeys = Object.keys(card.views)
    if (viewKeys.length === 0) return false
    const firstView = card.views[viewKeys[0]]
    if (!firstView || typeof firstView !== 'object' || !firstView.type) return false
    return true
  } catch {
    return false
  }
}

class ImageDisplayErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: Error): void {
    console.warn(
      '[image_display] UGCRenderer render error, falling back to <Image>:',
      error.message,
    )
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

function renderMarkdownDocument(text: string, keyPrefix: string): React.ReactNode {
  if (!text) return null

  return (
    <ReactMarkdown
      key={keyPrefix}
      remarkPlugins={[remarkGfm, remarkBreaks]}
      allowedElements={ALLOWED_MARKDOWN_ELEMENTS}
      unwrapDisallowed
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" className="underline break-all">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 min-w-0 border-l-2 border-zinc-300 pl-3 italic opacity-80 break-words [overflow-wrap:anywhere]">
            {children}
          </blockquote>
        ),
        code: ({ className, children, ...props }) => (
          <code
            {...props}
            className={[
              'rounded bg-black/5 px-1 py-0.5 font-mono text-[0.95em] break-all whitespace-pre-wrap',
              className,
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {children}
          </code>
        ),
        hr: () => <hr className="my-3 border-zinc-300" />,
        li: ({ children }) => (
          <li className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</li>
        ),
        ol: ({ children }) => (
          <ol className="my-2 min-w-0 list-inside list-decimal space-y-1">{children}</ol>
        ),
        p: ({ children }) => (
          <p className="my-0 min-w-0 break-words leading-relaxed [overflow-wrap:anywhere]">
            {children}
          </p>
        ),
        pre: ({ className, children, ...props }) => (
          <pre
            {...props}
            className={[
              'my-2 max-w-full overflow-x-auto rounded-lg bg-black/5 p-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere] sm:whitespace-pre',
              className,
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {children}
          </pre>
        ),
        ul: ({ children }) => (
          <ul className="my-2 min-w-0 list-inside list-disc space-y-1">{children}</ul>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

function renderMarkdownSegment(text: string, keyPrefix: string): React.ReactNode {
  if (!text) return null

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let literalIndex = 0

  for (const match of text.matchAll(UNSUPPORTED_MARKDOWN_IMAGE_REGEX)) {
    const matchText = match[0]
    const index = match.index ?? 0

    if (index > lastIndex) {
      parts.push(
        <React.Fragment key={`${keyPrefix}:md:${lastIndex}`}>
          {renderMarkdownDocument(text.slice(lastIndex, index), `${keyPrefix}:md:${lastIndex}`)}
        </React.Fragment>,
      )
    }

    parts.push(
      <React.Fragment key={`${keyPrefix}:literal:${literalIndex}`}>{matchText}</React.Fragment>,
    )
    lastIndex = index + matchText.length
    literalIndex++
  }

  if (lastIndex === 0) {
    return renderMarkdownDocument(text, keyPrefix)
  }

  if (lastIndex < text.length) {
    parts.push(
      <React.Fragment key={`${keyPrefix}:tail`}>
        {renderMarkdownDocument(text.slice(lastIndex), `${keyPrefix}:tail`)}
      </React.Fragment>,
    )
  }

  return parts.length > 0 ? <>{parts}</> : null
}

export function renderMessageContent(
  content: string,
  characterAssets: CharacterAsset[],
  assetUrlMap?: Record<string, string>,
  imageCommandUrlMap?: Record<string, string>,
  moduleRegex?: ModuleRegexEntry[],
  screenWidth?: number,
  defaultVariables?: Record<string, unknown>,
  characterName?: string,
  randomSeed?: string,
  _extraHeadHtml?: string,
  _scopeId?: string,
  uiCard?: Record<string, unknown> | null,
  uiCardRegistry?: InlineUiCardRegistry | null,
  onUiCardAction?: (type: string, actionId: string, payload?: unknown) => void,
  isLatestMessage?: boolean,
  imageDisplay?: Record<string, unknown> | null,
): React.ReactNode {
  const storageBaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

  const { processedContent } = prepareMessageContentForRendering(content)
  void screenWidth

  if ((uiCard || uiCardRegistry) && moduleRegex) {
    const inlineResult = renderWithInlineUiCard(
      processedContent,
      moduleRegex,
      uiCard,
      uiCardRegistry,
      assetUrlMap,
      isLatestMessage ? defaultVariables : undefined,
      characterAssets,
      imageCommandUrlMap,
      storageBaseUrl,
      onUiCardAction,
      imageDisplay,
      randomSeed,
    )
    if (inlineResult) return inlineResult
  }

  return renderContentWithEmotionImages(
    processedContent,
    characterAssets,
    assetUrlMap,
    imageCommandUrlMap,
    storageBaseUrl,
    imageDisplay,
    randomSeed,
  )
}

function renderWithInlineUiCard(
  processedContent: string,
  moduleRegex: ModuleRegexEntry[],
  uiCard: Record<string, unknown> | null | undefined,
  uiCardRegistry: InlineUiCardRegistry | null | undefined,
  assetUrlMap: Record<string, string> | undefined,
  defaultVariables: Record<string, unknown> | undefined,
  characterAssets: CharacterAsset[],
  imageCommandUrlMap: Record<string, string> | undefined,
  storageBaseUrl: string,
  onAction: ((type: string, actionId: string, payload?: unknown) => void) | undefined,
  imageDisplay?: Record<string, unknown> | null,
  randomSeed?: string,
): React.ReactNode | null {
  const allMatches = collectExtractRegexMatches(processedContent, moduleRegex)
  if (allMatches.length === 0) return null

  const sortedMatches = allMatches
    .slice()
    .sort(
      (a, b) =>
        a.index - b.index || a.entryIndex - b.entryIndex || b.matchText.length - a.matchText.length,
    )

  const acceptedMatches: Array<{
    index: number
    length: number
    cardJson: string
    state: Record<string, unknown>
    assets: Record<string, string>
    key: string
  }> = []

  let occupiedUntil = -1

  for (const match of sortedMatches) {
    if (match.index < occupiedUntil) continue

    const resolvedCard =
      typeof match.entry.card_ref === 'string' && match.entry.card_ref.trim()
        ? (uiCardRegistry?.[match.entry.card_ref.trim()] ?? null)
        : uiCard
    if (!resolvedCard) continue

    const cardState = resolvedCard.state as Record<string, unknown> | undefined
    const mergedState: Record<string, unknown> = {
      ...(cardState ?? {}),
      ...(defaultVariables ?? {}),
    }

    for (const [key, strValue] of Object.entries(match.bindings)) {
      const original = cardState?.[key]
      if (typeof original === 'number') {
        const n = Number(strValue)
        mergedState[key] = Number.isNaN(n) ? strValue : n
      } else if (typeof original === 'boolean') {
        mergedState[key] = strValue === 'true' || strValue === '1'
      } else {
        mergedState[key] = strValue
      }
    }

    let cardJson: string
    try {
      cardJson = JSON.stringify(resolvedCard)
    } catch {
      continue
    }

    acceptedMatches.push({
      index: match.index,
      length: match.matchText.length,
      cardJson,
      state: mergedState,
      assets: buildSuuAssetMap(
        resolvedCard.assets as Record<string, string> | undefined,
        assetUrlMap ?? {},
      ),
      key: `${match.entry.card_ref ?? 'legacy'}:${match.entryIndex}:${match.index}`,
    })
    occupiedUntil = match.index + match.matchText.length
  }

  if (acceptedMatches.length === 0) return null

  const parts: React.ReactNode[] = []
  let cursor = 0

  for (const match of acceptedMatches) {
    const before = processedContent.slice(cursor, match.index)
    if (before.trim()) {
      parts.push(
        <React.Fragment key={`text-before:${cursor}`}>
          {renderContentWithEmotionImages(
            before,
            characterAssets,
            assetUrlMap,
            imageCommandUrlMap,
            storageBaseUrl,
            imageDisplay,
            deriveSegmentRandomSeed(randomSeed, 'before', cursor),
          )}
        </React.Fragment>,
      )
    }

    parts.push(
      <UGCRenderer
        key={`ui-card:${match.key}`}
        card={match.cardJson}
        assets={match.assets}
        state={match.state}
        // Use "auto"; "visible" has no effect because contain:paint still clips
        hostOverflow="auto"
        onAction={onAction}
        onError={(errors) => console.warn('[UGCRenderer] Inline validation errors:', errors)}
      />,
    )

    cursor = match.index + match.length
  }

  const after = processedContent.slice(cursor)
  if (after.trim()) {
    parts.push(
      <React.Fragment key={`text-after:${cursor}`}>
        {renderContentWithEmotionImages(
          after,
          characterAssets,
          assetUrlMap,
          imageCommandUrlMap,
          storageBaseUrl,
          imageDisplay,
          deriveSegmentRandomSeed(randomSeed, 'after', cursor),
        )}
      </React.Fragment>,
    )
  }

  return <>{parts}</>
}

function renderContentWithEmotionImages(
  processedContent: string,
  characterAssets: CharacterAsset[],
  assetUrlMap: Record<string, string> | undefined,
  imageCommandUrlMap: Record<string, string> | undefined,
  storageBaseUrl: string,
  imageDisplay?: Record<string, unknown> | null,
  randomSeed?: string,
): React.ReactNode {
  const hasImageCommands = imageCommandUrlMap && Object.keys(imageCommandUrlMap).length > 0
  const hasAssets = characterAssets.length > 0

  if (!hasImageCommands && !hasAssets) {
    return <div>{renderMarkdownSegment(processedContent, 'plain')}</div>
  }

  const imageMatches = collectCanonicalAssetImageTokenMatches(processedContent)

  const imageDisplayJson = imageDisplay
    ? (() => {
        try {
          const json = JSON.stringify(imageDisplay)
          return validateImageDisplayCard(json) ? json : null
        } catch {
          return null
        }
      })()
    : null

  const parts: React.ReactNode[] = []
  let lastIndex = 0

  for (const match of imageMatches) {
    if (match.index > lastIndex) {
      const textPart = processedContent.substring(lastIndex, match.index)
      parts.push(
        <React.Fragment key={`text-${lastIndex}`}>
          {renderMarkdownSegment(textPart, `text-${lastIndex}`)}
        </React.Fragment>,
      )
    }

    const emotionName = match.assetKey
    const altText = match.altText

    const renderTarget = resolveEmotionRenderTarget({
      rawTag: emotionName,
      characterAssets,
      assetUrlMap,
      imageCommandUrlMap,
      storageBaseUrl,
      randomSeed: buildImageResolutionSeed(randomSeed, match.index, emotionName),
    })

    if (renderTarget) {
      const emotionUrl = renderTarget.resolvedUrl
      if (imageDisplayJson) {
        const imgAssetMap: Record<string, string> = {
          '@assets/emotion': emotionUrl,
          emotion: emotionUrl,
        }
        parts.push(
          <ImageDisplayErrorBoundary
            key={`emotion-${match.index}`}
            fallback={
              <Image
                src={emotionUrl}
                alt={altText}
                width={400}
                height={400}
                unoptimized
                className="rounded-lg my-2"
              />
            }
          >
            <UGCRenderer
              card={imageDisplayJson}
              assets={imgAssetMap}
              state={buildImageDisplayState(renderTarget)}
              // Use "auto"; "visible" has no effect because contain:paint still clips
              hostOverflow="auto"
              onError={(errors) => console.warn('[image_display] UGCRenderer errors:', errors)}
            />
          </ImageDisplayErrorBoundary>,
        )
      } else {
        parts.push(
          <Image
            key={`emotion-${match.index}`}
            src={emotionUrl}
            alt={altText}
            width={400}
            height={400}
            unoptimized
            className="rounded-lg my-2"
          />,
        )
      }
    }

    lastIndex = match.index + match.raw.length
  }

  if (lastIndex < processedContent.length) {
    const textPart = processedContent.substring(lastIndex)
    parts.push(
      <React.Fragment key={`text-${lastIndex}`}>
        {renderMarkdownSegment(textPart, `text-${lastIndex}`)}
      </React.Fragment>,
    )
  }

  return parts.length > 0 ? parts : <div>{renderMarkdownSegment(processedContent, 'plain')}</div>
}

function deriveSegmentRandomSeed(
  randomSeed: string | undefined,
  segment: 'before' | 'after',
  cursor: number,
): string | undefined {
  return randomSeed ? `${randomSeed}:${segment}:${cursor}` : undefined
}

function buildImageResolutionSeed(
  randomSeed: string | undefined,
  matchIndex: number,
  rawTag: string,
): string | undefined {
  return randomSeed ? `${randomSeed}:${matchIndex}:${rawTag}` : undefined
}
