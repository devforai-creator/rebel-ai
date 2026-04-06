import { describe, expect, it } from 'vitest'

import { detectFileType, isZipHeader } from './file-detection'

describe('detectFileType', () => {
  it('detects PNG headers', () => {
    const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    expect(detectFileType(header)).toBe('png')
  })

  it('detects JPEG headers', () => {
    const header = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])
    expect(detectFileType(header)).toBe('jpeg')
  })

  it('detects ZIP headers', () => {
    // PK\x03\x04 — ZIP local file header
    const header = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])
    expect(detectFileType(header)).toBe('zip')
  })

  it('returns unknown for other headers', () => {
    const header = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    expect(detectFileType(header)).toBe('unknown')
  })
})

describe('isZipHeader', () => {
  it('returns true for ZIP magic bytes', () => {
    expect(isZipHeader(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
  })

  it('returns false for non-ZIP bytes', () => {
    expect(isZipHeader(new Uint8Array([0x50, 0x4b, 0x00, 0x00]))).toBe(false)
  })

  it('returns false for short headers', () => {
    expect(isZipHeader(new Uint8Array([0x50, 0x4b]))).toBe(false)
    expect(isZipHeader(new Uint8Array([]))).toBe(false)
  })
})
