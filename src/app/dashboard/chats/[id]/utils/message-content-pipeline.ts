import { resolveAssetTag, resolveAssetUrl, type CharacterAsset } from '@/lib/asset-resolver'
import {
  collectCanonicalAssetImageTokenMatches,
  normalizeLegacyAssetImageTokens,
} from '@/lib/asset-token'
import type { ModuleRegexEntry } from './types'

const PIPELINE_TRACE_PREVIEW_LIMIT = 300
export type PipelineStepTrace = Readonly<{
  name: string
  length: number
  preview: string
  changed: boolean
}>

export type UnresolvedImageTag = Readonly<{
  original: string
  extractedName: string
}>

type PipelineTraceCollector = {
  steps: PipelineStepTrace[]
}

function buildPreview(value: string, limit: number): string {
  if (!value) return ''
  return value.length > limit ? value.slice(0, limit) : value
}

function appendPipelineStep(
  steps: PipelineStepTrace[] | undefined,
  name: string,
  value: string,
  previous: string | null,
): void {
  if (!steps) return
  steps.push({
    name,
    length: value.length,
    preview: buildPreview(value, PIPELINE_TRACE_PREVIEW_LIMIT),
    changed: previous !== null ? previous !== value : false,
  })
}

export function normalizeFullwidthChars(text: string): string {
  if (!/[｜［］：－–—]/.test(text)) {
    return text
  }
  return text
    .replace(/｜/g, '|')
    .replace(/［/g, '[')
    .replace(/］/g, ']')
    .replace(/：/g, ':')
    .replace(/[－–—]/g, '-')
}

function reorderMoveTopBlocks(content: string): string {
  if (!content.includes('@@move_top')) {
    return content
  }

  let processed = content
  if (processed.includes('@@move_top')) {
    const moveTopRegex = /@@move_top\s*([\s\S]*?)(?=@@move_top|$)/g
    const moveTopParts: string[] = []

    let match
    while ((match = moveTopRegex.exec(processed)) !== null) {
      moveTopParts.push(match[1].trim())
    }

    if (moveTopParts.length > 0) {
      const remainingContent = processed
        .replace(/@@move_top\s*[\s\S]*?(?=@@move_top|$)/g, '')
        .trim()
      processed = moveTopParts.join('\n') + '\n' + remainingContent
    }
  }

  return processed
}

export type PreparedMessageContentForRendering = Readonly<{
  processedContent: string
}>

export function prepareMessageContentForRendering(
  content: string,
  trace?: PipelineTraceCollector,
): PreparedMessageContentForRendering {
  appendPipelineStep(trace?.steps, 'original', content, null)

  const assetTokenNormalizedContent = normalizeLegacyAssetImageTokens(content)
  appendPipelineStep(
    trace?.steps,
    'after_asset_token_normalization',
    assetTokenNormalizedContent,
    content,
  )

  const fullwidthNormalizedContent = normalizeFullwidthChars(assetTokenNormalizedContent)
  appendPipelineStep(
    trace?.steps,
    'after_fullwidth_normalization',
    fullwidthNormalizedContent,
    assetTokenNormalizedContent,
  )

  const processedContent = reorderMoveTopBlocks(fullwidthNormalizedContent)
  appendPipelineStep(trace?.steps, 'after_move_top', processedContent, fullwidthNormalizedContent)

  return {
    processedContent,
  }
}

export type ClientRenderDiagnostics = Readonly<{
  screenWidth: number
  originalLength: number
  processedLength: number
  moduleRegexCount: number
  pipelineTrace: PipelineStepTrace[]
  unresolvedImageTags: UnresolvedImageTag[]
  unresolvedImageTagsRaw: UnresolvedImageTag[]
  embeddedHtmlDoc: null
}>

export function computeClientRenderDiagnostics(
  content: string,
  moduleRegex: ModuleRegexEntry[] | undefined,
  assetUrlMap: Record<string, string> | undefined,
  screenWidth?: number,
  defaultVariables?: Record<string, unknown>,
  characterName?: string,
  randomSeed?: string,
  extraHeadHtml?: string,
  characterAssets?: CharacterAsset[],
  imageCommandUrlMap?: Record<string, string>,
): ClientRenderDiagnostics {
  const effectiveScreenWidth = screenWidth ?? 1024
  const pipelineTrace: PipelineTraceCollector = { steps: [] }
  void screenWidth
  void defaultVariables
  void characterName
  void randomSeed
  void extraHeadHtml

  const { processedContent } = prepareMessageContentForRendering(content, pipelineTrace)

  const imageTags = collectImageTags(processedContent)
  const unresolvedImageTagsRaw =
    assetUrlMap && imageTags.length > 0
      ? filterUnresolvedImageTags(imageTags, (name) => Boolean(resolveAssetUrl(name, assetUrlMap)))
      : []
  const hasStrictResolvers =
    (imageCommandUrlMap && Object.keys(imageCommandUrlMap).length > 0) ||
    (characterAssets && characterAssets.length > 0)
  const storageBaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const unresolvedImageTags =
    hasStrictResolvers && imageTags.length > 0
      ? filterUnresolvedImageTags(imageTags, (name) =>
          resolveImageTagForDiagnostics(name, characterAssets, imageCommandUrlMap, storageBaseUrl),
        )
      : []
  return {
    screenWidth: effectiveScreenWidth,
    originalLength: content.length,
    processedLength: processedContent.length,
    moduleRegexCount: moduleRegex?.length ?? 0,
    pipelineTrace: pipelineTrace.steps,
    unresolvedImageTags,
    unresolvedImageTagsRaw,
    embeddedHtmlDoc: null,
  }
}

type ImageTag = Readonly<{ original: string; extractedName: string }>

function collectImageTags(content: string): ImageTag[] {
  if (!content) return []

  const seen = new Set<string>()
  const tags: ImageTag[] = []

  for (const match of collectCanonicalAssetImageTokenMatches(content)) {
    const key = `${match.raw}::${match.assetKey}`
    if (seen.has(key)) continue
    seen.add(key)

    tags.push({ original: match.raw, extractedName: match.assetKey })
  }

  return tags
}

function filterUnresolvedImageTags(
  tags: ImageTag[],
  isResolved: (name: string) => boolean,
): UnresolvedImageTag[] {
  const unresolved: UnresolvedImageTag[] = []

  for (const tag of tags) {
    if (isResolved(tag.extractedName)) continue
    unresolved.push(tag)
  }

  return unresolved
}

function resolveImageTagForDiagnostics(
  name: string,
  characterAssets: CharacterAsset[] | undefined,
  imageCommandUrlMap: Record<string, string> | undefined,
  storageBaseUrl: string,
): boolean {
  if (!name) return false

  if (imageCommandUrlMap && resolveAssetUrl(name, imageCommandUrlMap)) {
    return true
  }

  if (characterAssets && characterAssets.length > 0) {
    const resolved = resolveAssetTag(name, {
      assets: characterAssets,
      storageBaseUrl,
      bucketName: 'character-assets',
    })
    if (resolved) {
      return true
    }
  }

  return false
}
