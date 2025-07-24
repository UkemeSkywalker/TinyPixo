import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // For API routes that handle file uploads, increase the response timeout
  if (request.nextUrl.pathname.startsWith('/api/upload')) {
    // Add custom headers for debugging
    const response = NextResponse.next()
    response.headers.set('x-middleware-cache', 'no-cache')
    response.headers.set('x-upload-request', 'true')
    return response
  }
  
  return NextResponse.next()
}

// Configure which paths should be processed by this middleware
export const config = {
  matcher: [
    '/api/upload/:path*',
    '/api/convert-audio/:path*',
    '/api/convert-video/:path*',
  ],
}