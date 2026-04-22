type UploadableFileName = Pick<{ name: string }, 'name'>

export function buildImportUploadPrefix(userId: string) {
  return `${userId}/imports/`
}

export function isImportUploadPath(path: string, userId: string) {
  return path.startsWith(buildImportUploadPrefix(userId))
}

export function buildImportUploadPath(
  userId: string,
  file: UploadableFileName,
  createUniqueSuffix: () => string = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}`,
) {
  const sanitizedName = file.name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-\.(?=[^.]+$)/, '.')

  const safeName = sanitizedName || 'character.rbx'
  return `${buildImportUploadPrefix(userId)}${createUniqueSuffix()}-${safeName}`
}
