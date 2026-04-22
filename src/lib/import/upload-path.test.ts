import { describe, expect, it } from 'vitest'

import { buildImportUploadPath, buildImportUploadPrefix, isImportUploadPath } from './upload-path'

describe('upload-path', () => {
  it('builds staged upload paths under the user imports prefix', () => {
    expect(buildImportUploadPath('user-1', { name: 'My File.rbx' }, () => 'fixed-id')).toBe(
      'user-1/imports/fixed-id-my-file.rbx',
    )
  })

  it('recognizes only the staged imports prefix as a valid import upload path', () => {
    expect(buildImportUploadPrefix('user-1')).toBe('user-1/imports/')
    expect(isImportUploadPath('user-1/imports/file.rbx', 'user-1')).toBe(true)
    expect(isImportUploadPath('user-1/character-assets/file.png', 'user-1')).toBe(false)
    expect(isImportUploadPath('other-user/imports/file.rbx', 'user-1')).toBe(false)
  })
})
