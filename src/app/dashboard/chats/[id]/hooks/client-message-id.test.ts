import { describe, expect, it, vi } from 'vitest'
import { createClientMessageId } from './client-message-id'

describe('createClientMessageId', () => {
  it('uses randomUUID when the browser exposes it', () => {
    const randomUUID = vi.fn(() => '11111111-1111-4111-8111-111111111111')
    const getRandomValues = vi.fn((array: Uint8Array) => array)

    expect(createClientMessageId({ randomUUID, getRandomValues })).toBe(
      '11111111-1111-4111-8111-111111111111',
    )
    expect(getRandomValues).not.toHaveBeenCalled()
  })

  it('creates a version 4 UUID from getRandomValues when randomUUID is unavailable', () => {
    const sourceBytes = Uint8Array.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
      0x0f,
    ])
    const getRandomValues = vi.fn((array: Uint8Array) => {
      array.set(sourceBytes)
      return array
    })

    expect(createClientMessageId({ getRandomValues })).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })
})
