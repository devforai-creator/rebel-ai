import { afterEach, describe, expect, it } from 'vitest'

import { createImportUploadTicket, verifyImportUploadTicket } from './upload-ticket'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

describe('upload-ticket', () => {
  afterEach(() => {
    restoreEnv()
  })

  it('round-trips valid upload ticket claims', () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'

    const ticket = createImportUploadTicket({
      userId: 'user-1',
      path: 'user-1/imports/file.rbx',
      fileName: 'file.rbx',
      fileType: 'application/octet-stream',
      fileSize: 1024,
      expiresAt: Date.now() + 60_000,
    })

    expect(ticket).toEqual(expect.any(String))
    expect(verifyImportUploadTicket(ticket!)).toEqual({
      ok: true,
      claims: {
        userId: 'user-1',
        path: 'user-1/imports/file.rbx',
        fileName: 'file.rbx',
        fileType: 'application/octet-stream',
        fileSize: 1024,
        expiresAt: expect.any(Number),
      },
    })
  })

  it('returns expired tickets with claims so callers can clean up the staged upload safely', () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'

    const ticket = createImportUploadTicket({
      userId: 'user-1',
      path: 'user-1/imports/file.rbx',
      fileName: 'file.rbx',
      fileType: 'application/octet-stream',
      fileSize: 1024,
      expiresAt: Date.now() - 1_000,
    })

    expect(verifyImportUploadTicket(ticket!)).toEqual({
      ok: false,
      reason: 'expired',
      claims: {
        userId: 'user-1',
        path: 'user-1/imports/file.rbx',
        fileName: 'file.rbx',
        fileType: 'application/octet-stream',
        fileSize: 1024,
        expiresAt: expect.any(Number),
      },
    })
  })
})
