// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob } from './download-blob'

describe('downloadBlob', () => {
  const createObjectUrlMock = vi.fn()
  const revokeObjectUrlMock = vi.fn()
  const clickMock = vi.fn()

  beforeEach(() => {
    createObjectUrlMock.mockReset()
    revokeObjectUrlMock.mockReset()
    clickMock.mockReset()

    createObjectUrlMock.mockReturnValue('blob:test')
    HTMLAnchorElement.prototype.click = clickMock
    vi.stubGlobal('URL', {
      createObjectURL: createObjectUrlMock,
      revokeObjectURL: revokeObjectUrlMock,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a temporary download link and revokes the blob URL', () => {
    downloadBlob(new Blob(['payload']), 'export.json')

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1)
    expect(clickMock).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:test')
  })
})
