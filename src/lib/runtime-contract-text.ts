export const RUNTIME_TEMPLATE_SYNTAX = '{{'

export function hasRuntimeTemplateSyntax(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.includes(RUNTIME_TEMPLATE_SYNTAX)
}

export function getPlainTextRuntimeViolation(
  label: string,
  value: string | null | undefined,
): string | null {
  if (!hasRuntimeTemplateSyntax(value)) {
    return null
  }

  return `${label} must be plain text. Template syntax {{...}} is not allowed.`
}

export function getPlainTextRuntimeViolations(
  fields: Array<{ label: string; value: string | null | undefined }>,
): string[] {
  return fields
    .map((field) => getPlainTextRuntimeViolation(field.label, field.value))
    .filter((message): message is string => Boolean(message))
}
