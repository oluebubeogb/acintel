import { NextRequest, NextResponse } from 'next/server';
// Cheap gate: no session cookie → login. The API validates the session on every call.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/login') || pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname === '/favicon.svg') return NextResponse.next();
  if (!req.cookies.get('acintel_sid')) {
    const u = req.nextUrl.clone(); u.pathname = '/login'; u.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(u);
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
