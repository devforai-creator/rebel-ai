/**
 * Sanitize filenames before using them in Supabase Storage paths.
 *
 * This keeps RBX asset uploads resilient against odd Unicode punctuation
 * and duplicate file extensions produced by external tooling.
 */
export function sanitizeStorageKey(filename: string): string {
  let sanitized = filename
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/[\u00B7\u2022\u2027\u22C5\u2219]/g, '.')
    .replace(/[\u00A0\u202F\u2007\u2008\u2009\u200A\u200B]/g, ' ')
    .replace(/[\u200C\u200D\uFEFF]/g, '')

  const mediaExtensions = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'avif', 'mp4', 'webm']
  for (const ext of mediaExtensions) {
    const doubleExtPattern = new RegExp(`(\\.${ext})\\.(${ext})$`, 'i')
    while (doubleExtPattern.test(sanitized)) {
      sanitized = sanitized.replace(doubleExtPattern, '$1')
    }
  }

  return sanitized
}
