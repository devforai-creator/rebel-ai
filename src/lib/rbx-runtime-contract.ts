import type { RbxManifest } from '@/types/rbx.types'

/**
 * Import-boundary guard for the post-CharX RBX + SUU contract.
 *
 * Checks structural constraints only (unsupported legacy fields).
 * Template syntax ({{...}}) in text fields is allowed — the runtime
 * does not interpret it, so there is no security or correctness risk.
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
