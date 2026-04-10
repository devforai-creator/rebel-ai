import React from 'react'
import Image from 'next/image'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import type { CharacterAsset } from '@/lib/asset-resolver'
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

/**
 * Pre-render validation for image_display card JSON.
 * Parses the JSON and checks that the card has a valid view to render.
 * Returns null if the card is invalid (caller should fall back to <Image>).
 */
function validateImageDisplayCard(cardJson: string): boolean {
  try {
    const card = JSON.parse(cardJson)
    if (!card || typeof card !== 'object') return false
    if (!card.views || typeof card.views !== 'object') return false
    const viewKeys = Object.keys(card.views)
    if (viewKeys.length === 0) return false
    // Check that the first view has at least a type (minimal structure check)
    const firstView = card.views[viewKeys[0]]
    if (!firstView || typeof firstView !== 'object' || !firstView.type) return false
    return true
  } catch {
    return false
  }
}

/**
 * Error boundary for UGCRenderer. Last-resort safety net for unexpected render throws.
 * Pre-render validation (validateImageDisplayCard) handles the common failure cases;
 * this boundary catches only unforeseen runtime errors.
 */
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
          <blockquote className="my-2 border-l-2 border-zinc-300 pl-3 italic opacity-80">
            {children}
          </blockquote>
        ),
        code: ({ className, children, ...props }) => (
          <code
            {...props}
            className={['rounded bg-black/5 px-1 py-0.5 font-mono text-[0.95em]', className]
              .filter(Boolean)
              .join(' ')}
          >
            {children}
          </code>
        ),
        hr: () => <hr className="my-3 border-zinc-300" />,
        ol: ({ children }) => (
          <ol className="my-2 list-inside list-decimal space-y-1">{children}</ol>
        ),
        p: ({ children }) => <p className="my-0 leading-relaxed">{children}</p>,
        pre: ({ className, children, ...props }) => (
          <pre
            {...props}
            className={['my-2 overflow-x-auto rounded-lg bg-black/5 p-3', className]
              .filter(Boolean)
              .join(' ')}
          >
            {children}
          </pre>
        ),
        ul: ({ children }) => <ul className="my-2 list-inside list-disc space-y-1">{children}</ul>,
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

/**
 * Render message content with emotion images and plain-text message rendering
 *
 * Processing Pipeline (order matters - each step runs ONCE):
 * 1. Message Normalization
 *    - Fullwidth punctuation normalization
 *    - Legacy @@move_top reordering only
 *
 * 2. Emotion Image Rendering
 *    - ![alt](asset:key) → React Image component
 *    - Legacy image tokens normalize to the same canonical form upstream
 *
 * 3. Markdown Rendering
 *    - Remaining content renders as safe Markdown (GFM + single-newline breaks)
 *    - Raw HTML stays inert because rehype-raw is not enabled
 */
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
  // Get Supabase URL from environment
  const storageBaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

  const { processedContent } = prepareMessageContentForRendering(content)
  void screenWidth
  void randomSeed

  // Per-message inline UGCRenderer: replace extract regex match with ui_card component
  if ((uiCard || uiCardRegistry) && moduleRegex) {
    const inlineResult = renderWithInlineUiCard(
      processedContent,
      moduleRegex,
      uiCard,
      uiCardRegistry,
      assetUrlMap,
      // Historical snapshot: past messages only use extract results + ui_card.state.
      // Runtime variables (Toggle/Button) only apply to the latest message.
      isLatestMessage ? defaultVariables : undefined,
      characterAssets,
      imageCommandUrlMap,
      storageBaseUrl,
      onUiCardAction,
      imageDisplay,
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
  )
}

/**
 * Per-message inline UGCRenderer rendering.
 *
 * Finds all extract regex matches in processedContent, resolves each one to a
 * card, and renders text/card spans in message order.
 *
 * Returns null if no extract regex matches (caller falls through to default pipeline).
 */
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
        )}
      </React.Fragment>,
    )
  }

  return <>{parts}</>
}

const EMOTION_TAG_REGEX =
  /!\[([^\]]*)\]\(\s*asset:((?:[^)\s]|\s(?!\)))*[^)\s]?)\s*\)|<img\s*(?:="([^"]+)"|src=(?!["']?(?:https?:\/\/|data:))(?:"([^"]+)"|'([^']+)'|([^\s>"']+)))(?:\s*\/)?(?:\s*>)?|\[\s*🖼\s*\|\s*([^\]]+?)\s*\]|\{\{image::([^}]+)\}\}/gim

function getEmotionNameFromMatch(match: RegExpExecArray): string | null {
  return (match[2] || match[3] || match[4] || match[5] || match[6] || match[7] || match[8])?.trim()
}

function getEmotionAltFromMatch(match: RegExpExecArray, emotionName: string): string {
  const alt = match[1]?.trim()
  return alt || emotionName
}

function renderContentWithEmotionImages(
  processedContent: string,
  characterAssets: CharacterAsset[],
  assetUrlMap: Record<string, string> | undefined,
  imageCommandUrlMap: Record<string, string> | undefined,
  storageBaseUrl: string,
  imageDisplay?: Record<string, unknown> | null,
): React.ReactNode {
  const hasImageCommands = imageCommandUrlMap && Object.keys(imageCommandUrlMap).length > 0
  const hasAssets = characterAssets.length > 0

  if (!hasImageCommands && !hasAssets) {
    return <div>{renderMarkdownSegment(processedContent, 'plain')}</div>
  }

  // Find all emotion image tags that need resolution
  // Supports formats:
  // 1. ![alt](asset:key) - canonical RBX/RebelAI token
  // 2. <img="miro_happy"> - legacy inline asset tag
  // 3. <img src=miro_happy> - legacy HTML shorthand
  // 4. [ 🖼 | clothed_smile ] - legacy emoji token
  // 5. {{image::filename.png}} - legacy template token
  // NOTE: {{img::...}} is a retired legacy syntax and is no longer rewritten upstream
  // NOTE: http(s) and data: URLs are excluded - already resolved
  const regex = EMOTION_TAG_REGEX
  let match: RegExpExecArray | null

  // Pre-serialize and validate imageDisplay once before the loop.
  // If serialization or validation fails, imageDisplayJson stays null → fallback to <Image>.
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

  while ((match = regex.exec(processedContent)) !== null) {
    // Add text before the image token.
    if (match.index > lastIndex) {
      const textPart = processedContent.substring(lastIndex, match.index)
      parts.push(
        <React.Fragment key={`text-${lastIndex}`}>
          {renderMarkdownSegment(textPart, `text-${lastIndex}`)}
        </React.Fragment>,
      )
    }

    const emotionName = getEmotionNameFromMatch(match)
    if (!emotionName) continue
    const altText = getEmotionAltFromMatch(match, emotionName)

    const renderTarget = resolveEmotionRenderTarget({
      rawTag: emotionName,
      characterAssets,
      imageCommandUrlMap,
      storageBaseUrl,
    })

    if (renderTarget) {
      const emotionUrl = renderTarget.resolvedUrl
      if (imageDisplayJson) {
        // UCC-based image rendering: use card author's display template
        // Card JSON is pre-validated by validateImageDisplayCard() above.
        // ErrorBoundary is a last-resort safety net for unforeseen render throws.
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
              onError={(errors) => console.warn('[image_display] UGCRenderer errors:', errors)}
            />
          </ImageDisplayErrorBoundary>,
        )
      } else {
        // Legacy: hardcoded Image
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

    lastIndex = regex.lastIndex
  }

  // Add remaining text after the final image token.
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
