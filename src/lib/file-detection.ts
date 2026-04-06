export type DetectedFileType = 'png' | 'jpeg' | 'zip' | 'unknown'

/**
 * Check if a byte header starts with ZIP magic bytes (PK\x03\x04).
 */
export function isZipHeader(header: Uint8Array): boolean {
  return (
    header.length >= 4 &&
    header[0] === 0x50 && // P
    header[1] === 0x4b && // K
    header[2] === 0x03 &&
    header[3] === 0x04
  )
}

export function detectFileType(header: Uint8Array): DetectedFileType {
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return 'png'
  }

  if (header.length >= 2 && header[0] === 0xff && header[1] === 0xd8) {
    return 'jpeg'
  }

  if (isZipHeader(header)) {
    return 'zip'
  }

  return 'unknown'
}
