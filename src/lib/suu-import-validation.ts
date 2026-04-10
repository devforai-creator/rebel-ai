import { CARD_JSON_MAX_BYTES } from '@safe-ugc-ui/types'
import { loadCard, type ValidationError, type ValidationErrorCode } from '@safe-ugc-ui/validator'
import { isUnsafeImportedAssetUrl } from '@/lib/asset-url-safety'
import type { RbxCharacterMetadata } from '@/types/rbx.types'

const MAX_GENERIC_JSON_DEPTH = 48
const MAX_GENERIC_NODE_COUNT = 5000
const MAX_STRING_LENGTH = 100_000

const WARNING_VALIDATION_CODES = new Set<ValidationErrorCode>([
  'INVALID_JSON',
  'MISSING_FIELD',
  'INVALID_TYPE',
  'INVALID_VALUE',
  'UNKNOWN_NODE_TYPE',
  'SCHEMA_ERROR',
  'REF_NOT_ALLOWED',
  'DYNAMIC_NOT_ALLOWED',
  'STYLE_VALUE_OUT_OF_RANGE',
  'INVALID_COLOR',
  'INVALID_LENGTH',
  'LOOP_SOURCE_NOT_ARRAY',
  'LOOP_SOURCE_MISSING',
  'STYLE_REF_NOT_FOUND',
  'INVALID_STYLE_REF',
  'INVALID_STYLE_NAME',
  'FRAGMENT_REF_NOT_FOUND',
  'FRAGMENT_NESTED_USE',
  'INVALID_FRAGMENT_NAME',
  'INVALID_HOVER_STYLE',
  'HOVER_STYLE_NESTED',
  'TRANSITION_RAW_STRING',
  'TRANSITION_PROPERTY_FORBIDDEN',
])

const SRC_FIELD_NAMES = new Set(['src'])

type SuuImportIssueCode =
  | ValidationErrorCode
  | 'JSON_DEPTH_EXCEEDED'
  | 'JSON_NODE_COUNT_EXCEEDED'
  | 'STRING_LENGTH_EXCEEDED'

export type SuuImportValidationIssue = {
  severity: 'warning' | 'error'
  code: SuuImportIssueCode
  path: string
  message: string
}

export type SuuImportValidationSummary = {
  warnings: SuuImportValidationIssue[]
  errors: SuuImportValidationIssue[]
}

type ValidationBuckets = {
  warnings: SuuImportValidationIssue[]
  errors: SuuImportValidationIssue[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function createBuckets(): ValidationBuckets {
  return { warnings: [], errors: [] }
}

function pushIssue(buckets: ValidationBuckets, issue: SuuImportValidationIssue): ValidationBuckets {
  if (issue.severity === 'error') {
    buckets.errors.push(issue)
  } else {
    buckets.warnings.push(issue)
  }
  return buckets
}

function classifyValidatorIssue(error: ValidationError): 'warning' | 'error' {
  return WARNING_VALIDATION_CODES.has(error.code) ? 'warning' : 'error'
}

function formatPath(scope: string, path: string): string {
  return path ? `${scope}.${path}` : scope
}

function isStyleContextPath(path: string): boolean {
  return /(^|\.)(style|styles|hoverStyle|responsive)(\.|$)/.test(path)
}

function validateStableSafety(
  value: unknown,
  scope: string,
  path: string,
  depth: number,
  state: { nodeCount: number },
  buckets: ValidationBuckets,
): void {
  if (depth > MAX_GENERIC_JSON_DEPTH) {
    pushIssue(buckets, {
      severity: 'error',
      code: 'JSON_DEPTH_EXCEEDED',
      path,
      message: `SUU payload exceeds maximum JSON depth of ${MAX_GENERIC_JSON_DEPTH}.`,
    })
    return
  }

  state.nodeCount += 1
  if (state.nodeCount > MAX_GENERIC_NODE_COUNT) {
    pushIssue(buckets, {
      severity: 'error',
      code: 'JSON_NODE_COUNT_EXCEEDED',
      path: scope,
      message: `SUU payload exceeds maximum node count of ${MAX_GENERIC_NODE_COUNT}.`,
    })
    return
  }

  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      pushIssue(buckets, {
        severity: 'error',
        code: 'STRING_LENGTH_EXCEEDED',
        path,
        message: `SUU string value exceeds maximum length of ${MAX_STRING_LENGTH}.`,
      })
    }

    if (isStyleContextPath(path) && /url\s*\(/i.test(value)) {
      pushIssue(buckets, {
        severity: 'error',
        code: 'FORBIDDEN_CSS_FUNCTION',
        path,
        message: 'CSS url() is not allowed in imported SUU content.',
      })
    }

    return
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateStableSafety(value[index], scope, `${path}[${index}]`, depth + 1, state, buckets)
    }
    return
  }

  if (!isRecord(value)) {
    return
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key

    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      pushIssue(buckets, {
        severity: 'error',
        code: 'PROTOTYPE_POLLUTION',
        path: nextPath,
        message: 'Prototype-polluting keys are not allowed in imported SUU content.',
      })
      continue
    }

    if (SRC_FIELD_NAMES.has(key) && typeof child === 'string') {
      const normalized = child.trim()

      if (isUnsafeImportedAssetUrl(normalized)) {
        pushIssue(buckets, {
          severity: 'error',
          code: 'EXTERNAL_URL',
          path: nextPath,
          message: 'External or executable URLs are not allowed in imported SUU content.',
        })
        continue
      }

      if (normalized && !normalized.startsWith('@assets/')) {
        pushIssue(buckets, {
          severity: 'error',
          code: 'INVALID_ASSET_PATH',
          path: nextPath,
          message: 'Imported SUU asset paths must use the @assets/ prefix.',
        })
        continue
      }
    }

    validateStableSafety(child, scope, nextPath, depth + 1, state, buckets)
  }
}

function validateSingleCard(payload: unknown, scope: string): SuuImportValidationSummary {
  const buckets = createBuckets()
  if (payload == null) {
    return buckets
  }

  let serialized: string
  try {
    serialized = JSON.stringify(payload)
  } catch (error) {
    pushIssue(buckets, {
      severity: 'error',
      code: 'INVALID_JSON',
      path: scope,
      message: `Failed to serialize SUU payload: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    })
    return buckets
  }

  if (utf8ByteLength(serialized) > CARD_JSON_MAX_BYTES) {
    pushIssue(buckets, {
      severity: 'error',
      code: 'CARD_SIZE_EXCEEDED',
      path: scope,
      message: `SUU payload exceeds maximum size of ${CARD_JSON_MAX_BYTES} bytes.`,
    })
    return buckets
  }

  validateStableSafety(payload, scope, scope, 0, { nodeCount: 0 }, buckets)
  if (buckets.errors.length > 0) {
    return buckets
  }

  const result = loadCard(payload)
  if (result.valid) {
    return buckets
  }

  for (const error of result.errors) {
    pushIssue(buckets, {
      severity: classifyValidatorIssue(error),
      code: error.code,
      path: formatPath(scope, error.path),
      message: error.message,
    })
  }

  return buckets
}

function mergeSummaries(...summaries: SuuImportValidationSummary[]): SuuImportValidationSummary {
  const merged = createBuckets()
  for (const summary of summaries) {
    merged.warnings.push(...summary.warnings)
    merged.errors.push(...summary.errors)
  }
  return merged
}

export function validateSuuImportMetadata(
  metadata: Pick<RbxCharacterMetadata, 'ui_card' | 'ui_cards' | 'image_display'>,
): SuuImportValidationSummary {
  const summaries: SuuImportValidationSummary[] = []

  summaries.push(validateSingleCard(metadata.ui_card, 'character.metadata.ui_card'))
  summaries.push(validateSingleCard(metadata.image_display, 'character.metadata.image_display'))

  if (metadata.ui_cards && typeof metadata.ui_cards === 'object') {
    for (const [key, card] of Object.entries(metadata.ui_cards)) {
      summaries.push(validateSingleCard(card, `character.metadata.ui_cards.${key}`))
    }
  }

  return mergeSummaries(...summaries)
}

export function formatSuuImportValidationIssue(issue: SuuImportValidationIssue): string {
  return `[${issue.code}] ${issue.path}: ${issue.message}`
}
