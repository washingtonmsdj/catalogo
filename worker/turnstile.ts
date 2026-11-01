/** Canonical Turnstile Siteverify boundary shared by quotes and collections. */
export type TurnstileEnv = {
  TURNSTILE_SECRET_KEY?: string
  CORS_ORIGINS: string
}

export function configuredPublicOrigins(value: string): string[] {
  return value.split(',').map(origin => origin.trim()).filter(Boolean)
}

export function verifiedTurnstileResponse(
  payload: unknown,
  corsOrigins: string,
  requestOrigin: string | null,
  expectedAction: string,
): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const response = payload as { success?: unknown; action?: unknown; hostname?: unknown }
  if (response.success !== true || response.action !== expectedAction ||
      typeof response.hostname !== 'string' || !response.hostname) return false

  return configuredPublicOrigins(corsOrigins).some(origin => {
    try {
      const url = new URL(origin)
      return url.protocol === 'https:' && url.origin === origin &&
        url.hostname === response.hostname &&
        (requestOrigin === null || requestOrigin === origin)
    } catch {
      return false
    }
  })
}

export async function validateTurnstile(
  request: Request,
  env: TurnstileEnv,
  token: string,
  action: string = 'quote',
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY || !token || token.length > 2048) return false

  const body = new FormData()
  body.set('secret', env.TURNSTILE_SECRET_KEY)
  body.set('response', token)
  const remoteIp = request.headers.get('CF-Connecting-IP')
  if (remoteIp) body.set('remoteip', remoteIp)
  body.set('idempotency_key', crypto.randomUUID())

  try {
    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return false
    return verifiedTurnstileResponse(
      await response.json(), env.CORS_ORIGINS, request.headers.get('origin'), action,
    )
  } catch {
    return false
  }
}
