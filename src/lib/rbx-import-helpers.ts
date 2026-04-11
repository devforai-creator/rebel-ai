import type { Json } from '@/types/database.types'

export function getContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

export function sanitizeMetadataForDb(metadata: Record<string, unknown>): Json {
  const jsonString = JSON.stringify(metadata)
  const sanitized = jsonString.replace(/\\u0000/g, '')
  return JSON.parse(sanitized) as Json
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
