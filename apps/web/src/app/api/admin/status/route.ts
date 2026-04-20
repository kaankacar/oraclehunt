import { NextResponse } from 'next/server'
import { isAdminAuthenticated } from '@/lib/admin-auth'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({ authenticated: isAdminAuthenticated() })
}
