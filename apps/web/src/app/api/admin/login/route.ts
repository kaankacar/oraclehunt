import { NextRequest, NextResponse } from 'next/server'
import { setAdminSessionCookie, validateAdminPassword } from '@/lib/admin-auth'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  let body: { password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const password = body.password?.trim() ?? ''
  if (!password) {
    return NextResponse.json({ error: 'password is required' }, { status: 400 })
  }

  if (!validateAdminPassword(password)) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 })
  }

  setAdminSessionCookie()
  return NextResponse.json({ ok: true })
}
