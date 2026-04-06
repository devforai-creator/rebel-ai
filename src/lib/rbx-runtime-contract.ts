import type { RbxManifest } from '@/types/rbx.types'
import { getPlainTextRuntimeViolation } from '@/lib/runtime-contract-text'

/**
 * Temporary import-boundary guard for the post-CharX RBX + SUU contract.
 *
 * The parser still accepts some legacy fields for v1.x compatibility. This helper
 * is the hard gate that prevents those fields from entering the database while
 * existing content is being migrated. Once the contract is fully adopted, this
 * logic can be folded into the schema/parser or removed entirely.
 */
export function assertRbxRuntimeContract(manifest: RbxManifest): void {
  const violations = getRbxRuntimeContractViolations(manifest)
  if (violations.length === 0) {
    return
  }

  throw new Error(
    `RBX import rejected by runtime contract:\n${violations
      .map((violation) => `  - ${violation}`)
      .join('\n')}`,
  )
}

export function getRbxRuntimeContractViolations(manifest: RbxManifest): string[] {
  const violations: string[] = []
  const metadata = manifest.character.metadata

  if (hasNonEmptyString(metadata.background_html)) {
    violations.push('character.metadata.background_html is not supported. Use ui_card instead.')
  }

  pushIfPresent(
    violations,
    getPlainTextRuntimeViolation('character.system_prompt', manifest.character.system_prompt),
  )

  pushIfPresent(
    violations,
    getPlainTextRuntimeViolation(
      'character.metadata.post_history_instructions',
      metadata.post_history_instructions,
    ),
  )

  pushIfPresent(
    violations,
    getPlainTextRuntimeViolation('character.greeting_message', manifest.character.greeting_message),
  )

  metadata.alternate_greetings.forEach((greeting, index) => {
    pushIfPresent(
      violations,
      getPlainTextRuntimeViolation(`character.metadata.alternate_greetings[${index}]`, greeting),
    )
  })

  manifest.modules.forEach((attachment, moduleIndex) => {
    const moduleRecord = attachment.module as Record<string, unknown>

    if (hasPopulatedLegacyField(moduleRecord.triggers)) {
      violations.push(
        `modules[${moduleIndex}].module.triggers is not supported. Use ui_card Button or Toggle actions instead.`,
      )
    }

    if (hasPopulatedLegacyField(moduleRecord.toggle_definitions)) {
      violations.push(
        `modules[${moduleIndex}].module.toggle_definitions is not supported. Use ui_card Toggle state instead.`,
      )
    }

    const rawRegexEntries = Array.isArray(moduleRecord.regex) ? moduleRecord.regex : []
    rawRegexEntries.forEach((regex, regexIndex) => {
      const regexRecord = regex as Record<string, unknown>
      if (regexRecord.type === 'editdisplay') {
        violations.push(
          `modules[${moduleIndex}].module.regex[${regexIndex}] uses editdisplay, which is not supported. Use extract with bindings instead.`,
        )
      }
    })

    attachment.module.lorebook.forEach((entry, entryIndex) => {
      pushIfPresent(
        violations,
        getPlainTextRuntimeViolation(
          `modules[${moduleIndex}].module.lorebook[${entryIndex}].content`,
          entry.content,
        ),
      )
    })
  })

  return violations
}

function hasNonEmptyString(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasPopulatedLegacyField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).length > 0
  }

  return false
}

function pushIfPresent(values: string[], candidate: string | null): void {
  if (candidate) {
    values.push(candidate)
  }
}
