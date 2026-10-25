// Same-origin proxy to the Nest API. Reads API_INTERNAL_URL at runtime (Coolify-friendly):
// the browser only ever talks to the web origin, so the session cookie stays first-party.
import { NextRequest } from 'next/server';
export const dynamic = 'force-dynamic';
const API = () => (process.env.API_INTERNAL_URL || 'http://localhost:4000').replace(/\/$/, '');

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  const url = `${API()}/${params.path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const h of ['cookie', 'content-type', 'accept', 'user-agent']) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  // Real client IP for the API's login rate limit + audit (Coolify/Traefik sets these).
  const fwd = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || req.ip;
  if (fwd) headers.set('x-forwarded-for', fwd);
  headers.set('x-forwarded-proto', (req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')).split(',')[0]);
  const real = req.headers.get('x-real-ip'); if (real) headers.set('x-real-ip', real);
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
  try {
    // req.signal: closing the tab aborts the upstream request (important for the SSE stream).
    const r = await fetch(url, { method: req.method, headers, body, redirect: 'manual', cache: 'no-store', signal: req.signal });
    const out = new Headers();
    r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(k)) out.set(k, v); });
    for (const c of (r.headers as any).getSetCookie?.() || []) out.append('set-cookie', c);
    if ((r.headers.get('content-type') || '').includes('text/event-stream')) {
      out.set('cache-control', 'no-cache, no-transform'); out.set('x-accel-buffering', 'no'); out.set('connection', 'keep-alive');
    }
    return new Response(r.body, { status: r.status, headers: out });
  } catch (e: any) {
    if (e?.name === 'AbortError') return new Response(null, { status: 499 });
    return Response.json({ statusCode: 502, message: 'AcIntel API is unreachable' }, { status: 502 });
  }
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
