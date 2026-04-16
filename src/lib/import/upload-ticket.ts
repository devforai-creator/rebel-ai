import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

export type ImportUploadTicketClaims = {
  userId: string
  path: string
  fileName: string
  fileType: string | null
  fileSize: number
  expiresAt: number
}

type ImportUploadTicketVerification =
  | { ok: true; claims: ImportUploadTicketClaims }
  | { ok: false; reason: 'invalid' | 'expired' | 'missing_secret' }

function getImportUploadTicketSecret() {
  return process.env.CHAT_ADMIN_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? null
}

function signPayload(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest()
}

export function createImportUploadTicket(claims: ImportUploadTicketClaims): string | null {
  const secret = getImportUploadTicketSecret()
  if (!secret) {
    return null
  }

  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signature = signPayload(payload, secret).toString('base64url')
  return `${payload}.${signature}`
}

export function verifyImportUploadTicket(ticket: string): ImportUploadTicketVerification {
  const secret = getImportUploadTicketSecret()
  if (!secret) {
    return { ok: false, reason: 'missing_secret' }
  }

  const [encodedPayload, encodedSignature] = ticket.split('.')
  if (!encodedPayload || !encodedSignature) {
    return { ok: false, reason: 'invalid' }
  }

  let providedSignature: Buffer
  try {
    providedSignature = Buffer.from(encodedSignature, 'base64url')
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  const expectedSignature = signPayload(encodedPayload, secret)
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return { ok: false, reason: 'invalid' }
  }

  let claims: ImportUploadTicketClaims
  try {
    claims = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as ImportUploadTicketClaims
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  if (!Number.isFinite(claims.expiresAt) || claims.expiresAt < Date.now()) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true, claims }
}
