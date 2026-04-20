import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'

const ADMIN_COOKIE_NAME = 'oraclehunt_admin'
const SESSION_PAYLOAD = 'oraclehunt-admin-session'

function getAdminPassword(): string {
  const password = process.env.ADMIN_PASSWORD ?? process.env.NEXT_PUBLIC_ADMIN_PASSWORD
  if (!password) {
    throw new Error('Missing ADMIN_PASSWORD')
  }
  return password
}

function signSession(password: string): string {
  return createHmac('sha256', password).update(SESSION_PAYLOAD).digest('hex')
}

export function createAdminSessionValue(): string {
  return signSession(getAdminPassword())
}

export function validateAdminPassword(candidate: string): boolean {
  const expected = Buffer.from(getAdminPassword())
  const provided = Buffer.from(candidate)
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

export function setAdminSessionCookie() {
  cookies().set(ADMIN_COOKIE_NAME, createAdminSessionValue(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8,
  })
}

export function clearAdminSessionCookie() {
  cookies().delete(ADMIN_COOKIE_NAME)
}

export function isAdminAuthenticated(): boolean {
  const session = cookies().get(ADMIN_COOKIE_NAME)?.value
  if (!session) return false
  const expected = createAdminSessionValue()
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(session)
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
}
