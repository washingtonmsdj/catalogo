type R2Bucket = {
  put(
    key: string,
    value: ReadableStream,
    options?: { httpMetadata?: { contentType: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>
}

interface Env {
  MEDIA: R2Bucket
  ALLOWED_IP: string
  SESSION_ID: string
  EXPIRES_AT: string
}

const MAX_OBJECT_BYTES = 25 * 1024 * 1024
const ALLOWED_PREFIXES = ['media/', 'gallery/'] as const

function deny(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

function isValidKey(key: string) {
  return ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))
    && !key.includes('..')
    && !key.includes('\\')
    && key.length <= 512
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const now = Date.now()
    const expiresAt = Date.parse(env.EXPIRES_AT)
    if (!Number.isFinite(expiresAt) || now >= expiresAt) return deny(410, 'ingest_session_expired')
    if ((request.headers.get('CF-Connecting-IP') ?? '') !== env.ALLOWED_IP) return deny(403, 'source_not_allowed')
    if ((request.headers.get('X-Ingest-Session') ?? '') !== env.SESSION_ID) return deny(401, 'invalid_session')
    if (request.method !== 'PUT') return deny(405, 'method_not_allowed')

    const key = (request.headers.get('X-Object-Key') ?? '').trim()
    if (!isValidKey(key)) return deny(400, 'invalid_key')
    if (!request.body) return deny(400, 'body_required')

    const contentLength = Number(request.headers.get('Content-Length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_OBJECT_BYTES) return deny(413, 'object_too_large')

    const contentType = request.headers.get('Content-Type') || 'application/octet-stream'
    await env.MEDIA.put(key, request.body, {
      httpMetadata: { contentType },
      customMetadata: { ingestSession: env.SESSION_ID },
    })

    return new Response('ok', {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    })
  },
}
